import mongoose from 'mongoose'
import logger from '../../common/logger.js'
import {
   PerforceCheckInMembersFilterSchema, flattenPerforceCheckinMembers
} from './report-configuration.js'

const TeamGroupSchema = new mongoose.Schema({
   code: {
      type: String,
      required: true
   },
   name: {
      type: String,
      required: true
   },
   membersFilters: {
      type: [PerforceCheckInMembersFilterSchema]
   },
   members: {
      type: [String],
      require: true
   }

}, { timestamps: true })

const TeamGroup = mongoose.model('TeamGroup', TeamGroupSchema)

const updateTeamGroup = async () => {
   const initTeams = [{
      code: 'vsan',
      name: 'vsan engineer',
      membersFilters: [{
         condition: 'include',
         type: 'all_reporters',
         // include vgunturu(WAAPGUG8J), WPVQ9M7QT(WPVQ9M7QT), bstoicov(WAAGN7CBE) all
         members: ['WAAPGUG8J', 'WPVQ9M7QT', 'WAAGN7CBE']
      },
      {
         condition: 'include',
         type: 'selected',
         // include amdurm(WAA2WLE72), daip(WABL9CTK8)
         members: ['WAA2WLE72', 'WABL9CTK8']
      }
      ]
   }]

   // init teams empty data in db
   await Promise.all(initTeams.map(team => {
      return TeamGroup.findOne({ code: team.code }).then(res => {
         if (res == null) {
            const newTeam = new TeamGroup(team)
            return newTeam.save().then(res => {
               logger.info(`save init team ${res} in db`)
            })
         }
      })
   }))

   const teams = await TeamGroup.find()
   await Promise.all(teams.map(async team => {
      const members = await flattenPerforceCheckinMembers(team.membersFilters)
      team.members = members
      await team.save()
      logger.info(`saved team ${team.name} members ${JSON.stringify(team.members)}`)
   }))
}

export { TeamGroup, updateTeamGroup }
