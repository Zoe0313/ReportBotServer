# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
__init__.py
'''

from generator.src.notification import perforce_checkin_report
from generator.src.notification import bugzilla_component_report

generatorType = "perforce_checkin_report"

if "perforce_checkin_report" == generatorType:
   args = perforce_checkin_report.parseArgs()
   spider = perforce_checkin_report.PerforceSpider(args)
elif "bugzilla_component_report" == generatorType:
   args = bugzilla_component_report.parseArgs()
   spider = bugzilla_component_report.BugzillaComponentSpider(args)
elif "bugzilla_assignee_report" == generatorType:
   pass