#!/bin/bash

date -u

cd /root/bugzilla/healthNannyReminder
path=`pwd`
echo "path: $path"
arr=`cat ./listdev`
echo "arr: $arr"
current=`cat ./currentdev`
echo "current: $current"
found=0
newcurr=0
for i in $arr; do if [[ "$current" == "$i" ]];then found=1;continue;fi;if [[ $found == 1 ]];then  newcurr=$i;break;fi;done
if [[ $found == 0 ]];then echo "Wrong user name!";exit 1;fi
if [[ $newcurr == 0 ]];then for i in $arr;do newcurr=$i;break;done;fi
if [[ $newcurr != 0 ]];then echo $newcurr > ./currentdev;else echo "Not Found!";exit 1;fi
echo "last week: $current, this week: $newcurr"

# prod channel G8BPVGU7Q
# Test channel G012BLW9C6R

curl -X POST -H 'Authorization: Bearer xoxb-283832321142-a0S4ic9wy9QWN6rlh9P6H7ic' -H 'Content-type: application/json;charset=utf-8' --data "{\"channel\":\"G012BLW9C6R\",\"text\":\"<@${newcurr}> You are Health nanny this week.\"}"  https://slack.com/api/chat.postMessage

found=0
newcurr=0
current=0

echo -e "\n\n"