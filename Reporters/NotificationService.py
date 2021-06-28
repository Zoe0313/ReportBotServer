import subprocess
import json
import requests

CONTENT_TYPE_JSON = "Content-type: application/json"
CONTENT_TYPE_JSON_UTF = "Content-type: application/json;charset=utf-8"
CONTENT_TYPE_URLENCODE = "Content-type: application/x-www-form-urlencoded"
AUTH = "xoxb-2154537752-833403957187-yPWkRumT1Ayc3jq76H4TsviU"

class NotificationService():
   def __init__(self, botConfig, reportConfig, isTest):
      self.name = ""
      self.slack_post_url = botConfig.slackPostUrl
      self.slack_lookup_url = botConfig.slackLookupUrl
      self.slack_imopen_url = botConfig.slackImopenUrl
      self.user_id = ""

      # update channel id
      if isTest:
         self.targetChannelId = [botConfig.testChannelId]
      else:
         self.targetChannelId = reportConfig.channelId
         if botConfig.testChannelId not in self.targetChannelId:
            self.targetChannelId.append(botConfig.testChannelId)

      self.channel_id = botConfig.testChannelId
      self.userValid = False
      self.bearer_auth = "Authorization: Bearer %s" % AUTH
   
   def SendMessage(self, message):
      for channel in self.targetChannelId:
         self.sendMessage(message)

   def setup(self, name):
      self.name = name
      self.user_id = self._getUserId()
      assert self.user_id != "", "user : %s is not found in vmware workspace." % self.name
      self.userValid = True
      self.channel_id = self._getChannelId("darren-test-channel")
      assert self.channel_id != "", "channel id do not exist."

   def sendMessage(self, msg=""):
      msgjson = '{"channel":"%s","text":"%s"}' % (self.channel_id, msg)
      headers = {'content-type': 'application/json', 'Authorization': 'Bearer %s' % AUTH}
      r = requests.post(self.slack_post_url, data=msgjson, headers=headers)

   def _executeCmd(self, cmd):
      output, _ = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True).communicate()
      return json.loads(output)

   def _getUserId(self):
      lookup_url = self.slack_lookup_url % self.name
      cmd = "curl -X GET -H '%s' -H '%s' %s" % (self.bearer_auth, CONTENT_TYPE_URLENCODE, lookup_url)
      result = self._executeCmd(cmd)
      if result['ok']:
         return result['user']['id']
      else:
         return ""

   def _getChannelId(self, channelName):
      user_map = '{"channel":"%s"}' % channelName
      cmd = "curl -X POST -H '%s' -H '%s' --data '%s' %s" % (
         self.bearer_auth, CONTENT_TYPE_JSON_UTF, user_map, self.slack_imopen_url)
      result = self._executeCmd(cmd)
      if result['ok']:
         return result['channel']['id']
      else:
         return ""