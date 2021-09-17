#!/usr/bin/env python3
import argparse
import requests

MY_TOKEN = '5083e5a7a2c74acfa85792fbee23e1aa'

def SendMessage(channelId, message):
   messageQuoted = requests.utils.quote(message)
   param = "channel-id=%s&message=%s&token=%s" % (channelId, message, MY_TOKEN)
   requests.post('https://slack-rest-api.svc-stage.ara.decc.vmware.com:443/slack/message/?%s' % param,
                 verify=False)

def main():
   parser = argparse.ArgumentParser(prog='send-message')
   runGroup = parser.add_argument_group(title='send slack message')
   runGroup.add_argument('--message', type=str, required=True)
   runGroup.add_argument('--channel', type=str, required=True)

   args = parser.parse_args()

   SendMessage(args.channel, args.message)

if __name__ == '__main__':
   main()

