# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
__init__.py
'''

from generator.src.notification import perforce_checkin_report
from generator.src.notification import bugzilla_report
from generator.src.notification import bugzilla_assignee_report
from generator.src.notification import svs_pass_rate_report

generatorType = "bugzilla_report"

if "perforce_checkin_report" == generatorType:
   args = perforce_checkin_report.parseArgs()
   spider = perforce_checkin_report.PerforceSpider(args)
elif "bugzilla_report" == generatorType:
   args = bugzilla_report.parseArgs()
   spider = bugzilla_report.BugzillaSpider(args)
elif "bugzilla_assignee_report" == generatorType:
   args = bugzilla_assignee_report.parseArgs()
   spider = bugzilla_assignee_report.BugzillaAssigneeSpider(args)
elif "svs_pass_rate_report" == generatorType:
   args = svs_pass_rate_report.parseArgs()
   spider = svs_pass_rate_report.SVSPassRateSpider(args)
