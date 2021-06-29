from CommonUtils import botConst
import requests


class BugzillaUtils(object):

   @classmethod
   def getHtmlContent(cls, url, session, timeout=30):
      res = session.get(url, headers=dict(referer=url))
      return res.content

   @classmethod
   def getBugzillaApiSession(cls):
      payload = {
         "Bugzilla_login": botConst.Bugzilla_Username,
         "Bugzilla_password": botConst.Bugzilla_Password
      }
      session = requests.session()
      login_url = "https://bugzilla.eng.vmware.com/"
      session.post(
         login_url,
         data=payload,
         headers=dict(referer=login_url)
      )
      return session
