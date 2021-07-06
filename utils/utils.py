import os
import subprocess

def RunCmd(cmd):
   process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
   process.wait()
   output = process.stdout.read()
   print(output)
   error = process.stderr.read()
   if error:
      print(cmd)
      print(error)
   return output