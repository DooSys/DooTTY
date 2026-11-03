use std::sync::{Condvar, Mutex};

/// Bound output in flight until xterm's write callback acknowledges parsing.
pub struct Flow {
    state: Mutex<(usize, bool)>,
    changed: Condvar,
    limit: usize,
}

impl Flow {
    pub fn new(limit: usize) -> Self {
        Self {
            state: Mutex::new((0, false)),
            changed: Condvar::new(),
            limit,
        }
    }
    pub fn reserve(&self, bytes: usize) -> bool {
        if bytes > self.limit {
            return false;
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        while !state.1 && bytes > self.limit.saturating_sub(state.0) {
            state = self.changed.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        if state.1 {
            return false;
        }
        state.0 += bytes;
        true
    }
    pub fn ack(&self, bytes: usize) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.0 = state.0.saturating_sub(bytes);
        self.changed.notify_all();
    }
    pub fn cancel(&self) {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).1 = true;
        self.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{mpsc, Arc},
        time::Duration,
    };
    #[test]
    fn oversized_reservations_fail_without_waiting_or_overflowing() {
        let flow = Flow::new(8);
        assert!(!flow.reserve(9));
        assert!(!flow.reserve(usize::MAX));
        assert!(flow.reserve(8));
    }
    #[test]
    fn output_waits_for_consumer_then_can_be_cancelled() {
        let flow = Arc::new(Flow::new(8));
        assert!(flow.reserve(8));
        let (tx, rx) = mpsc::channel();
        let worker_flow = flow.clone();
        let worker = std::thread::spawn(move || {
            tx.send(worker_flow.reserve(1)).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        flow.ack(8);
        assert!(rx.recv_timeout(Duration::from_secs(1)).unwrap());
        worker.join().unwrap();
        flow.cancel();
        assert!(!flow.reserve(1));
    }
    #[test]
    fn cancellation_wakes_a_blocked_reader() {
        let flow = Arc::new(Flow::new(1));
        assert!(flow.reserve(1));
        let other = flow.clone();
        let worker = std::thread::spawn(move || other.reserve(1));
        flow.cancel();
        assert!(!worker.join().unwrap());
    }
}
