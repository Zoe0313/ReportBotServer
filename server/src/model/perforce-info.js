import mongoose from 'mongoose'
import { ExecCommand } from '../../common/utils.js'
import logger from '../../common/logger.js'

const PerforceInfoSchema = new mongoose.Schema({
   project: {
      type: String,
      required: true
   },
   branches: {
      type: [String],
      required: true
   }
}, { timestamps: true })

const PerforceInfo = mongoose.model('PerforceInfo', PerforceInfoSchema)

const P4Login = async () => {
   const cmd = `echo ${process.env.P4PASSWORD} | /build/apps/bin/p4 -u ${process.env.P4USER} login`
   await ExecCommand(cmd, 10 * 60 * 1000)
   logger.info('p4 login')
}

const UpdateP4Branches = async () => {
   const initProjects = ['bora', 'scons', 'vsan-mgmt-ui']
   // init projects empty data in db
   await Promise.all(initProjects.map(project => {
      return PerforceInfo.findOne({ project }).then(res => {
         if (res == null) {
            const perforceInfo = new PerforceInfo({ project, branches: [] })
            return perforceInfo.save().then(res => {
               logger.info(`save init project ${res} in db`)
            })
         }
      })
   }))
   logger.info('start to update perforce branches in db')
   await P4Login()
   const perforceInfos = await PerforceInfo.find()
   const projects = perforceInfos.map(info => info.project)
   const stdoutList = await Promise.all(projects.map(project => {
      const cmd = `/build/apps/bin/p4 -u ${process.env.P4USER} dirs //depot/${project}/*`
      return ExecCommand(cmd, 10 * 60 * 1000).catch(e => {
         logger.error(`can't get branches for project ${project} for error ${JSON.stringify(e)}`)
         return null
      })
   }))
   stdoutList.forEach((stdout, index) => {
      const project = projects[index]
      if (stdout == null || stdout === '') {
         logger.warn(`the stdout is invalid`)
      } else {
         const branches = stdout.split('\n').map(branch => {
            if (branch === '') {
               return null
            }
            const branchInfoIndex = branch.lastIndexOf('/')
            if (branchInfoIndex > 0 && branchInfoIndex < branch.length - 1) {
               return branch.substr(branchInfoIndex + 1)
            } else {
               logger.warn(`branch ${branch} of project ${project} is invalid.`)
               return null
            }
         }).filter(branch => branch)
         PerforceInfo.findOne({ project }).then(perforceInfo => {
            perforceInfo.branches = branches
            perforceInfo.save().then(res => {
               logger.info(`branches list of perforce project ${project} has been updated successfully.`)
            })
         })
      }
   })
}

export { PerforceInfo, UpdateP4Branches }
