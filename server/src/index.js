import dotenv from 'dotenv'
dotenv.config()

import bolt from '@slack/bolt'
import express from 'express'
import { main_service, create_report_service } from './bolt_service/index.js'
import { mongo_database } from './database-adapter.js'
import { performance } from 'perf_hooks'

mongo_database(async () => {
})

const receiver = new bolt.ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET })

receiver.router.use(express.json())

const app = new bolt.App({
    socketMode: true,
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
    // receiver
})

app.use(async ({ body, next }) => {
    const user = body?.user?.id || body?.message?.user || body?.event?.message?.user
    const type = body?.subtype || body?.type
    const t0 = performance.now()
    await next()
    const t1 = performance.now()
    console.log(`${user} did ${type} took ${(t1 - t0)} milliseconds.`)
})

main_service(app)
create_report_service(app)

app.start()
receiver.start(process.env.PORT || 3000);
console.log('⚡️ Bolt app is running!')