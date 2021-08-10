import dotenv from 'dotenv'
dotenv.config()

import schedule from 'node-schedule'
import { ReportHistory } from '../../src/model/report-history.js'
import { format_date } from './utils.js'
import { exec } from 'child_process'
import { WebClient } from '@slack/web-api'

const scheduleJobStore = {}
const client = new WebClient(process.env.SLACK_BOT_TOKEN)

const execCommand = function(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) reject(error)
            else resolve(stdout)
        })
    })
}

const commonHandler = async (report) => {
    console.log(`schedule for ${report.title} ${report._id}`)
    // const REPORT_TYPE_ENUM = ['bugzilla', 'perforce', 'svs', 'fastsvs', 'text', 'customized']
    const handleExecCommand = async (command, report) => {
        try {
            const stdout = await execCommand(command)
            console.log(stdout)
            if (client != null) {
                await Promise.all(
                    report.conversations.map(conversation => {
                        client.chat.postMessage({
                            channel: conversation,
                            text: stdout
                        })
                    })
                )
                const reportHistory = new ReportHistory({
                    reportConfigId: report._id,
                    title: report.title,
                    creator: report.creator,
                    reportType: report.reportType,
                    conversations: report.conversations,
                    reportUsers: report.reportUsers,
                    sentTime: new Date(),
                    content: stdout,
                    result: true
                })
                reportHistory.save()
            }
        } catch (e) {
            console.error(e)
            const reportHistory = new ReportHistory({
                reportConfigId: report._id,
                title: report.title,
                creator: report.creator,
                reportType: report.reportType,
                conversations: report.conversations,
                reportUsers: report.reportUsers,
                sentTime: new Date(),
                content: e.message,
                result: false
            })
            reportHistory.save()
        }
    }
    switch (report.reportType) {
        case 'bugzilla':
            const scriptPath = '/Users/ysixuan/Projects/git/slackbot/bugzilla/reportGenerator.py'
            await handleExecCommand(`python3 ${scriptPath} --title '${report.title}' --url '${report.reportLink}'`, report)
            break
        case 'perforce': 
            break
        case 'svs': 
            break
        case 'fastsvs': 
            break
        case 'text': 
            break
        case 'customized': 
            break
    }
}

const unregisterSchedule = function(id) {
    if (id == null) return
    console.log(`start to cancel previous schedule job ${id}`)
    let job = scheduleJobStore[id]
    if (job != null) {
        console.log(`cancel previous schedule job ${id}`)
        job.cancel()
    } else {
        console.log(`failed to cancel previous schedule job ${id}`)
    }
    delete scheduleJobStore[id]
}

const registerSchedule = function(report) {
    if (process.env.ENABLE_SCHEDULE != 'true') return
    const id = report._id 
    if (id == null) return
    let job = scheduleJobStore[id]
    if (job != null) {
        console.log(`cancel previous schedule job ${id} ${report.title}`)
        job.cancel()
    }
    const repeatConfig = report.repeatConfig
    const dateRange = { start: repeatConfig.startDate, end: repeatConfig.endDate }
    let rule = null
    switch (repeatConfig.repeatType) {
        case 'not_repeat':
            const date = format_date(repeatConfig.date) + ' ' + repeatConfig.time
            job = schedule.scheduleJob(date, function (report) {
                commonHandler(report)
            }.bind(null, report))
            break
        case 'hourly': 
            rule = new schedule.RecurrenceRule()
            rule.minute = repeatConfig.minsOfHour;
            job = schedule.scheduleJob({ ...dateRange, rule }, function (report) {
                commonHandler(report)
            }.bind(null, report))
            break
        case 'daily': 
            rule = new schedule.RecurrenceRule()
            rule.hour = repeatConfig.time.split(':')[0]
            rule.minute = repeatConfig.time.split(':')[1]
            job = schedule.scheduleJob({ ...dateRange, rule }, function (report) {
                commonHandler(report)
            }.bind(null, report))
            break
        case 'weekly': 
            rule = new schedule.RecurrenceRule()
            rule.dayOfWeek = repeatConfig.dayOfWeek
            rule.hour = repeatConfig.time.split(':')[0]
            rule.minute = repeatConfig.time.split(':')[1]
            job = schedule.scheduleJob({ ...dateRange, rule }, function (report) {
                commonHandler(report)
            }.bind(null, report))
            break
        case 'monthly': 
            rule = new schedule.RecurrenceRule()
            rule.date = repeatConfig.dayOfMonth
            rule.hour = repeatConfig.time.split(':')[0]
            rule.minute = repeatConfig.time.split(':')[1]
            job = schedule.scheduleJob({ ...dateRange, rule }, function (report) {
                commonHandler(report)
            }.bind(null, report))
            break
        case 'cron_expression': 
            job = schedule.scheduleJob({ ...dateRange, rule: repeatConfig.cronExpression }, function (report) {
                commonHandler(report)
            }.bind(null, report))
            break
    }
    scheduleJobStore[report._id] = job
    console.log(`success to schedule job ${report._id} ${report.title}`)
    return job
}

const nextInvocation = function(id) {
    if (id == null) return
    console.log(`start to query next invocation for job ${id}`)
    let job = scheduleJobStore[id]
    if (job != null) {
        return job.nextInvocation()
    } else {
        console.log(`failed to query next invocation since no job for ${id}`)
        return null
    }
}

const cancelNextInvocation = function(id) {
    if (id == null) return
    console.log(`start to cancel next invocation for job ${id}`)
    let job = scheduleJobStore[id]
    if (job != null) {
        job.cancelNext()
    } else {
        console.log(`failed to cancel next invocation since no job for ${id}`)
    }

}


export { registerSchedule, unregisterSchedule, nextInvocation, cancelNextInvocation }