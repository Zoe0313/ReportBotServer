import { load_blocks } from '../utils.js'
import { ReportConfiguration, REPORT_STATUS } from '../model/report-configuration.js'

export function create_report_service(app) {

    // New report message configuration
    app.action({
        'block_id': 'block_welcome', 
        'action_id': 'action_create'
    }, async({ ack, body, client }) => {
        console.log('open create report config modal')
        if (ack) await ack()
        try {
            const reportModalBasic = load_blocks('modal/report-basic')
            const reportModalTime = load_blocks('modal/report-time')
            const blocks = reportModalBasic.concat(reportModalTime)
            await client.views.open({
                trigger_id: body.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'view_create_report',
                    title: {
                        type: 'plain_text',
                        text: 'Create your new report'
                    },
                    blocks,
                    submit: {
                        type: 'plain_text',
                        text: 'Submit'
                    }
                },
                submit_disabled: true,
            })
        } catch (e) {
            console.error(e)
        }
    })

    const updateModal = async ({ ack, payload, body, client }) => {
        await ack()
        try {
            const reportType = body.view.state.values
                ?.block_report_type?.action_report_type?.selected_option?.value
            const repeatType = body.view.state.values
                ?.block_repeat_type?.action_repeat_type?.selected_option?.value
            console.log(`select report type ${reportType} of report scheduler`)
            console.log(`select repeat type ${repeatType} of report scheduler`)
            
            const reportModalBasic = load_blocks('modal/report-basic')
            const reportModalReportType = load_blocks(`report_type/${reportType}`)
            const reportModalTime = load_blocks('modal/report-time')
            const reportModalRepeatType = load_blocks(`repeat_type/${repeatType}`)
            const blocks = reportModalBasic.concat(reportModalReportType)
                .concat(reportModalTime).concat(reportModalRepeatType)
            await client.views.update({    
                view_id: body.view.id,
                hash: body.view.hash,
                view: {
                    type: 'modal',
                    callback_id: 'view_create_report',
                    title: {
                        type: 'plain_text',
                        text: 'Create your new report'
                    },
                    blocks,
                    submit: {
                        type: 'plain_text',
                        text: 'Submit'
                    }
                }
            })
        } catch(e) {
            console.error(e)
        }
    }

    app.action({
        'block_id': 'block_repeat_type', 
        'action_id': 'action_repeat_type'
    }, async (event) => {
        await updateModal(event)
    })

    app.action({
        'block_id': 'block_report_type', 
        'action_id': 'action_report_type'
    }, async (event) => {
        await updateModal(event)
    })

    // Precheck and create a report request
    app.view('view_create_report', async ({ ack, body, view, client }) => {
        await ack()
        const user = body['user']['id']
        const inputObj = {}
        const inputValues = Object.values(view['state']['values'])
        inputValues.forEach(actions => {
            Object.keys(actions).forEach(actionKey => {
                inputObj[actionKey] = actions[actionKey]
            })
        })
        console.log(inputObj)
        const parseIntNullable = (num) => num ? parseInt(num) : null
        const report = new ReportConfiguration({
            title: inputObj.action_title?.value,
            creator: user,
            status: REPORT_STATUS.CREATED,
            reportType: inputObj.action_report_type?.selected_option?.value,
            reportLink: inputObj.action_report_link?.value,
            conversations: inputObj.action_conversation?.selected_conversations,
            reportUsers: inputObj.action_report_users?.selected_users,
            startDate: inputObj.action_start_date?.selected_date,
            endDate: inputObj.action_end_date?.selected_date,
            repeatConfig: {
                repeatType: inputObj.action_repeat_type?.selected_option?.value,
                cronExpression: inputObj.action_cron_expression?.value,
                date: inputObj.action_date?.selected_date,
                time: inputObj.action_time?.selected_time,
                dayOfMonth: parseIntNullable(inputObj.action_day_of_month?.value),
                dayOfWeek: inputObj.action_day_of_week?.selected_options
                    ?.map(option => parseIntNullable(option.value)),
                minsOfHour: parseIntNullable(inputObj.action_mins_of_hour?.value),
            }
        })
        console.log(report)
        try {
            const saved = await report.save()
            console.log(`Create successful. saved report id ${saved._id}`)
            const blocks = load_blocks('precheck-report')
            // create inited status report
            blocks.find(block => block.block_id === 'block_create_last')
                .elements.forEach(element => element.value = saved._id)
            await client.chat.postMessage({
                channel: user,
                blocks: blocks,
                text: 'Precheck your new report'
            })
        } catch (e) {
            console.log(e.message)
            await client.chat.postMessage({
                channel: user,
                text: e.message
            })
        }
    })

    // Listen to the action_create_done action
    app.action({
        'block_id': 'block_create_last', 
        'action_id': 'action_create_done'
    }, async ({ ack, payload, body, say, client }) => {
        await ack()
        // change to enable status
        console.log(body)
        const ts = body['message']['ts']
        const id = payload.value
        if (!ts || !id) return
        console.log(`report id : ${id}`)
        console.log(`ts : ${ts}`)
        try {
            const report = await ReportConfiguration.findById(id)
            console.log(`report : ${report}`)
            report.status = REPORT_STATUS.ENABLED
            await report.save()
            const blocks = load_blocks('done-create')
            await client.chat.update({
                channel: body.channel.id,
                ts,
                blocks: blocks,
                text: 'Create and enable new report configuration!'
            })
        } catch (e) {
            await say({
                text: e.message
            })
        }
    })

    // Listen to the action_create_save action
    app.action({
        'block_id': 'block_create_last', 
        'action_id': 'action_create_save'
    }, async ({ ack, payload, body, say, client }) => {
        await ack()
        // change to draft status
        const ts = body['message']['ts']
        const id = payload.value
        console.log(`report id : ${id}`)
        try {
            const report = await ReportConfiguration.findById(id)
            report.status = REPORT_STATUS.DRAFT
            await report.save()
            await client.chat.update({
                channel: body.channel.id,
                ts,
                blocks: [],
                text: 'Saved draft report configuration.'
            })
        } catch (e) {
            await say({
                text: e.message
            })
        }
    })

    // Listen to the action_create_cancel action
    app.action({
        'block_id': 'block_create_last', 
        'action_id': 'action_create_cancel'
    }, async ({ ack, payload, body, say, client }) => {
        await ack()
        // remove record in db
        const ts = body['message']['ts']
        const id = payload.value
        console.log(`report id : ${id}`)
        try {
            await ReportConfiguration.deleteOne({ _id: id })
            await client.chat.update({
                channel: body.channel.id,
                ts,
                blocks: [],
                text: 'Cancel creation.'
            })
        } catch (e) {
            await say({
                text: e.message
            })
        }
    })
}