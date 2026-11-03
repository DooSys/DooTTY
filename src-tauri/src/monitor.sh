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
printf '@df\n'; df -Pk -l -x tmpfs -x devtmpfs 2>/dev/null | head -65
