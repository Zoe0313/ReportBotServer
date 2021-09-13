#!/usr/bin/env python3
# coding: utf8

import json
import time
import platform
import urllib
from urllib.parse import urlsplit, parse_qs
from http.server import BaseHTTPRequestHandler, HTTPServer
import socketserver
import re
from base64 import b64encode, b64decode
import ssl
import os
import threading
import queue
from six import with_metaclass
import requests
from pymongo import MongoClient

token_info = {}
HOST_NAME = "https://%s" % platform.uname()[1]
PORT_NUMBER = 443

def SendSlackNotification(channelId, message):
   payload = '{"channel":"%s","text":"%s"}' % (channelId, message)

   headers = {
      'Authorization': 'Bearer xoxb-2154537752-2142146055571-5oTMYmMRrRuOp4nNp6qMQq0d',
      'Content-type': 'application/json',
   }

   r = requests.post(url="https://slack.com/api/chat.postMessage",
                     headers=headers,
                     data=payload)
   print("Send %s to %s, result: %s" % (message, channelId, r))


class ThreadingSimpleServer(socketserver.ThreadingMixIn,
                            HTTPServer):
   # this is used by unittest
   pass


class Singleton(type):
   _lock = threading.Lock()
   _instances = {}
   def __call__(cls, *args, **kwds):
      if cls not in cls._instances:
         # ensure thread safe
         with cls._lock:
            if cls not in cls._instances:
               instance = super(Singleton, cls).__call__(*args, **kwds)
               cls._instances[cls] = instance
      return cls._instances[cls]

class SlackMongoConnection(with_metaclass(Singleton)):
   def __init__(self):
      self.mongoClient = MongoClient("mongodb://slackbot-server-db.ara.decc.vmware.com", port=27017)
      self.db = self.mongoClient.slackbot

   def queryToken(self, token):
      results = self.db.user_api_tokens_poc.find({'token': token})

      if results.count() < 1:
         return None
      rec = results[0]
      return rec.get('id')


class TaskMonitor(with_metaclass(Singleton)):
   def __init__(self):
      self.que = queue.Queue(maxsize=200)
      #TODO: init task que by database
      self._handleTask()

   def addTask(self, parms):
      # TODO: also add it into database
      self.que.put(parms)

   def _handleTask(self):
      print("Start Task Daemon ...")

      def _triggerTask():
         while True:
            try:
               task_info = self.que.get()
               #TODO: handle task here
               # 1) check svs status
               print("Handling task = %s" % task_info)
               # 2) if done, post result to reviewboard via genernal comment
               # TODO: if it's done, remove it from db, or update status there
               channelIds = task_info.get('channel-id')
               message = task_info.get('message')[0]
               token = task_info.get('token')[0]

               for channelId in channelIds:
                  SendSlackNotification(channelId=channelId, message=message)
                  print("Send message %s to channel %s" % (message, channelId))
               print("Completed task = %s" % task_info)

            except Exception as e:
               print("Fail to handle task %s" % e)

      thread = threading.Thread(
         target=_triggerTask,
         name="TaskMonitor")
      thread.daemon = True
      thread.start()


class SlackbotRestApiServiceHTTPRequestHandler(BaseHTTPRequestHandler):

   def send_result(self, return_code, result):
      self.send_response(return_code)
      self.send_header("Content-type", "application/json; charset=utf8")
      self.end_headers()
      self.wfile.write(json.dumps(result).encode("utf-8"))

   def do_POST(self):
      return_code = 400
      body = {
         "error": {
            "code": 400,
            "message": "Unsupported by this slackbot rest api service by now.",
            "status": "Bad_Request"
         }
      }
      parse_result = urlsplit(self.path)
      query_params = parse_qs(parse_result.query)

      if "slack/message" in parse_result.path:
         channelIds = query_params.get("channel-id")
         message = query_params.get("message")
         token = query_params.get("token")

         if (message is None or len(message) == 0) or (token is None or len(token) != 1):
            return_code, body = 400, {
               "errorMsg": "invalid request"
            }
            self.send_result(return_code, body)
            return

         userId = SlackMongoConnection().queryToken(token[0])
         print(userId)
         if userId is None:
            return_code, body = 401, {
               "errorMsg": "token %s invalid" % token
            }
         else:
            TaskMonitor().addTask(query_params)
            return_code, body = 200, {
               "status": {
                  "message": "Task is submitted: channelIds: %s ,"
                             " message %s" % (channelIds, message),
               }
            }
      self.send_result(return_code, body)

   def do_GET(self):
      return_code = 400
      body = {
         "error": {
            "code": 400,
            "message": "Unsupported by this slackbot rest api service by now.",
            "status": "Bad_Request"
         }
      }
      self.send_result(return_code, body)


if __name__ == "__main__":

   httpd = HTTPServer(("", PORT_NUMBER), SlackbotRestApiServiceHTTPRequestHandler)
   print(time.asctime(), "Server Starts - %s:%s" % (HOST_NAME, PORT_NUMBER))
   httpd.socket = ssl.wrap_socket(
      httpd.socket,
      keyfile=os.path.join(os.getcwd(), "private.key"),
      certfile=os.path.join(os.getcwd(), "server.pem"),
      server_side=True)
   t = TaskMonitor()
   try:
      httpd.serve_forever()
   except KeyboardInterrupt:
      pass
   httpd.server_close()
   print(time.asctime(), "Server Stops - %s:%s" % (HOST_NAME, PORT_NUMBER))
