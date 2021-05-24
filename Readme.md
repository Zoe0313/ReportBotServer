# Slackbot as a Service

This project is for building a slack bot service.

The reason why we need this service is that, managers have so many internal
websites to visit in order to get know about their teams working status. We
want to provide a centralized place for them to grab all the information. Of
course, it would be better this service is customizable.

## Current Services we have

### Monitoring Service

These services designed for specific problem, basically not customizable.

#### vSAN HCL duplicated PCI ID issue monitor

This bot helps to find out the new added
duplicated PCI ID devices during the last week. It also detects if there is any
self-recovered hardware devices. The principle is: we compare the bad-dup
devices from this week and last week, find the diff then send the report.

#### vSAN UT coverage monitor
This bot reads the UT coverage rate data from a Google
sheet, and generate the UT coverage report, the Google sheet's data is collected
from CAT API.

#### vSAN svs pass rate monitor
This is an important service which helps us to know there is an SVS p0 issue as
early as possible.

#### vSAN Health pass rate monitor
(Not implemented) This bot aims to connect phone home server, read the health
pass rate of the customer environments in order to detect real issues.


### Report Service

The bug reports are highly customizable. Including: report sending frequency and
time, report content, report format, target channel, etc.

This part could be considered to be implemented as a customized service, the
user could interact with the slack bot, give the customization configures, and
deploy the slack bots for themselves.

#### Bug count by component reporters

This is the most widely used type of this service, currently we have:

NoGoBugReporter, vsan2OverallBugRepoter, vsan2MustFixBugReporter, vmcBugReporter
, 70U3BugReporter, healthNannyPendingTriageBugReporter...

The principle is based on python crawler, the user just need to provide the
shortened url of the bugzilla report, then we will crawl each component's url,
generate the reports, and send it to the Slack channel.

#### Team bug daily reporter
Report the passing ETA bug, or p0 bug, at the assignee in team channel.


### Reminding Service

#### Nanny Reminder

healthNannyRoleReminder: A shell script which rotates the nannys every week, and
announce who is the nanny at the start of a working week.

#### Pending Triaged Bug Reminder

healthNannyBugReminder: A reminder which will notify the nanny every hour for the
new in-coming bugs. The principle is also based on the diff.

vsanNannyBugReminder: A reminder which will notify the nanny every hour for the
new in-coming bugs.

newBugReminderBeforeRelease: A reminder which will be enabled when we are
approaching a new vSphere release, all bugs being set fixed by <That release
version> need to be triaged immediately and fixed ASAP.

