# A single finite snapshot: no daemon and no files written in the distribution.
export LC_ALL=C PATH=/usr/sbin:/usr/bin:/sbin:/bin
printf '@stat\n'; cat /proc/stat
printf '@mem\n'; cat /proc/meminfo
printf '@uptime\n'; cat /proc/uptime
printf '@user\n'; id -un
printf '@host\n'; uname -n
printf '@kernel\n'; uname -r
printf '@interface\n'; awk '$2 == "00000000" && $8 == "00000000" { print $1; exit }' /proc/net/route
printf '@net\n'; cat /proc/net/dev
printf '@root\n'; awk '$5 == "/" { print $3; exit }' /proc/self/mountinfo
printf '@disk\n'; cat /proc/diskstats
# Query Linux storage only: root and block volumes, without technical mounts.
# The Windows volume backing the VHDX is measured separately through Win32.
printf '@df\n'
awk '
  {
    for (i=7; i<=NF; i++) if ($i == "-") {
      source=$(i+2)
      if ($5 == "/") root=source
      else if ($5 !~ /^\/usr\/lib\/(linux-tools|wsl)(\/|$)/ && $5 !~ /^\/usr\/src\/linux-headers(-|\/|$)/ && $5 !~ /^\/mnt\/wslg(\/|$)/ &&
          (source ~ /^\/dev\// && source !~ /^\/dev\/loop/)) {
        mounts[++n]=$5; devices[n]=source
      }
      break
    }
  }
  END {
    seen[root]=1
    for (i=1; i<=n && count<63; i++) if (!seen[devices[i]]++) {
      mount=mounts[i]; gsub(/\\040/, " ", mount)
      print mount; count++
    }
  }
' /proc/self/mountinfo | {
  set -- /
  while IFS= read -r mount; do set -- "$@" "$mount"; done
  df -Pk -- "$@" 2>/dev/null | head -65
}
