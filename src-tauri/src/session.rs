use crate::{config::validate_size, flow::Flow};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::{
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Duration,
};

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Event {
    Data {
        bytes: Vec<u8>,
    },
    Exit {
        code: Option<u32>,
        error: Option<String>,
    },
}

type Reply = mpsc::SyncSender<Result<(), String>>;
struct Input {
    bytes: Vec<u8>,
    reply: Reply,
}
struct Resize {
    cols: u16,
    rows: u16,
    reply: Reply,
}

pub struct Session {
    input: mpsc::SyncSender<Input>,
    resize: mpsc::SyncSender<Resize>,
    stop: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
    flow: Arc<Flow>,
}

impl Session {
    pub fn spawn(
        command: CommandBuilder,
        cols: u16,
        rows: u16,
        output: Arc<dyn Fn(Event) -> bool + Send + Sync>,
    ) -> Result<Self, String> {
        validate_size(cols, rows)?;
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|e| format!("Création du terminal impossible : {e}"))?;
        // Acquire all fallible handles before launching a child.
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| format!("Démarrage de WSL impossible : {e}"))?;
        drop(pair.slave);
        let master = pair.master;
        let flow = Arc::new(Flow::new(256 * 1024));
        let stop = Arc::new(AtomicBool::new(false));
        let alive = Arc::new(AtomicBool::new(true));
        let reader_done = Arc::new(AtomicBool::new(false));
        let (input_tx, input_rx) = mpsc::sync_channel::<Input>(8);
        let (resize_tx, resize_rx) = mpsc::sync_channel::<Resize>(8);

        let read_flow = flow.clone();
        let read_stop = stop.clone();
        let read_done = reader_done.clone();
        let read_output = output.clone();
        let read_thread = thread::spawn(move || {
            let mut buffer = [0; 8192];
            let result = loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break Ok(()),
                    Ok(count) => {
                        // On shutdown keep draining ConPTY without sending to a dead UI.
                        if read_flow.reserve(count)
                            && !read_output(Event::Data {
                                bytes: buffer[..count].to_vec(),
                            })
                        {
                            read_stop.store(true, Ordering::Release);
                            read_flow.cancel();
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(e) => break Err(e.to_string()),
                }
            };
            read_done.store(true, Ordering::Release);
            result
        });
        let write_stop = stop.clone();
        let write_thread = thread::spawn(move || {
            while !write_stop.load(Ordering::Acquire) {
                match input_rx.recv_timeout(Duration::from_millis(20)) {
                    Ok(input) => {
                        let result = writer
                            .write_all(&input.bytes)
                            .and_then(|()| writer.flush())
                            .map_err(|e| e.to_string());
                        let failed = result.is_err();
                        let _ = input.reply.send(result);
                        if failed {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => (),
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        let worker_stop = stop.clone();
        let worker_alive = alive.clone();
        let worker_flow = flow.clone();
        thread::spawn(move || {
            let mut error = None;
            let mut code = None;
            loop {
                if worker_stop.load(Ordering::Acquire) {
                    worker_flow.cancel();
                    let _ = child.kill();
                    break;
                }
                match child.try_wait() {
                    Ok(Some(status)) => {
                        code = Some(status.exit_code());
                        break;
                    }
                    Err(e) => {
                        error = Some(e.to_string());
                        worker_flow.cancel();
                        let _ = child.kill();
                        break;
                    }
                    Ok(None) => (),
                }
                if reader_done.load(Ordering::Acquire) {
                    let _ = child.kill();
                    break;
                }
                match resize_rx.recv_timeout(Duration::from_millis(20)) {
                    Ok(request) => {
                        let result = master
                            .resize(size(request.cols, request.rows))
                            .map_err(|e| e.to_string());
                        let _ = request.reply.send(result);
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        worker_stop.store(true, Ordering::Release);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => (),
                }
            }
            worker_stop.store(true, Ordering::Release);
            // Reader is still active while ClosePseudoConsole emits its final frame.
            // Input has its own thread so a blocked paste never holds the control loop.
            drop(master);
            let _ = write_thread.join();
            match read_thread.join() {
                Ok(Err(message)) if error.is_none() && code.is_none() => error = Some(message),
                Err(_) => error = Some("Le lecteur du terminal s’est arrêté anormalement.".into()),
                _ => (),
            }
            let _ = child.wait();
            worker_alive.store(false, Ordering::Release);
            output(Event::Exit { code, error });
        });

        Ok(Self {
            input: input_tx,
            resize: resize_tx,
            stop,
            alive,
            flow,
        })
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }
    pub fn is_stopping(&self) -> bool {
        self.stop.load(Ordering::Acquire)
    }
    pub fn write(&self, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.len() > 8192 {
            return Err("Bloc d’entrée trop volumineux.".into());
        }
        if !self.is_alive() {
            return Err("La session est terminée.".into());
        }
        let (tx, rx) = mpsc::sync_channel(1);
        self.input
            .send(Input { bytes, reply: tx })
            .map_err(|_| "La session est fermée.".to_string())?;
        rx.recv()
            .map_err(|_| "La session est fermée.".to_string())?
    }
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        validate_size(cols, rows)?;
        let (tx, rx) = mpsc::sync_channel(1);
        self.resize
            .send(Resize {
                cols,
                rows,
                reply: tx,
            })
            .map_err(|_| "La session est fermée.".to_string())?;
        rx.recv()
            .map_err(|_| "La session est fermée.".to_string())?
    }
    pub fn ack(&self, bytes: usize) {
        self.flow.ack(bytes);
    }
    pub fn close(&self) {
        self.stop.store(true, Ordering::Release);
        self.flow.cancel();
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn pty_preserves_utf8_input_resize_and_exit_order() {
        let mut command = CommandBuilder::new("/bin/sh");
        command.args([
            "-c",
            "printf 'prêt\\n'; read answer; printf 'reçu:%s\\n' \"$answer\"; exit 7",
        ]);
        let (tx, rx) = mpsc::channel();
        let session =
            Session::spawn(command, 80, 24, Arc::new(move |e| tx.send(e).is_ok())).unwrap();
        session.resize(100, 30).unwrap();
        session.write("été\n".as_bytes().to_vec()).unwrap();
        let mut bytes = Vec::new();
        loop {
            match rx.recv_timeout(Duration::from_secs(5)).unwrap() {
                Event::Data { bytes: chunk } => {
                    session.ack(chunk.len());
                    bytes.extend(chunk);
                }
                Event::Exit { code, error } => {
                    assert_eq!(code, Some(7));
                    assert_eq!(error, None);
                    break;
                }
            }
        }
        assert!(String::from_utf8(bytes).unwrap().contains("reçu:été"));
        assert!(!session.is_alive());
    }

    #[test]
    fn close_unblocks_output_without_acknowledgements() {
        let mut command = CommandBuilder::new("/bin/sh");
        command.args([
            "-c",
            "while :; do printf '0123456789012345678901234567890123456789'; done",
        ]);
        let (tx, rx) = mpsc::channel();
        let session =
            Session::spawn(command, 80, 24, Arc::new(move |e| tx.send(e).is_ok())).unwrap();
        rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(!session.is_stopping());
        session.close();
        assert!(session.is_stopping());
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            assert!(Instant::now() < deadline, "session did not close");
            if matches!(
                rx.recv_timeout(Duration::from_secs(1)).unwrap(),
                Event::Exit { .. }
            ) {
                break;
            }
        }
    }

    #[test]
    fn closing_one_pty_leaves_another_session_interactive() {
        let mut first = CommandBuilder::new("/bin/sh");
        first.args(["-c", "read input"]);
        let session1 = Session::spawn(first, 80, 24, Arc::new(|_| true)).unwrap();
        let mut second = CommandBuilder::new("/bin/sh");
        second.args(["-c", "read input; printf 'second:%s\\n' \"$input\""]);
        let (tx, rx) = mpsc::channel();
        let session2 =
            Session::spawn(second, 80, 24, Arc::new(move |e| tx.send(e).is_ok())).unwrap();
        session1.close();
        let deadline = Instant::now() + Duration::from_secs(3);
        while session1.is_alive() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(!session1.is_alive());
        assert!(session2.is_alive());
        session2.write(b"still-alive\n".to_vec()).unwrap();
        let mut output = Vec::new();
        loop {
            match rx.recv_timeout(Duration::from_secs(3)).unwrap() {
                Event::Data { bytes } => {
                    session2.ack(bytes.len());
                    output.extend(bytes);
                }
                Event::Exit { code, error } => {
                    assert_eq!(code, Some(0));
                    assert_eq!(error, None);
                    break;
                }
            }
        }
        assert!(String::from_utf8(output)
            .unwrap()
            .contains("second:still-alive"));
    }
}
