import mongoose from 'mongoose'
import logger from '../../common/logger.js'
import {
   PerforceCheckInMembersFilterSchema, FlattenMembers
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

const UpdateTeamGroup = async () => {
   const initTeams = [
      {
         code: 'vsan',
         name: 'vsan engineers',
         membersFilters: [{
            condition: 'include',
            type: 'all_reporters',
            // include ninadk(WABQS3KK9), pudis(WABQY8DF1) all
            members: ['WABQS3KK9', 'WABQY8DF1']
         },
         {
            condition: 'include',
            type: 'selected',
            // include amdurm(WAA2WLE72), daip(WABL9CTK8), adesai(WABLDKJPQ),
            // wenguangw(WAAGMNVHS), ochen(WCJQY2KSM) all
            members: ['WAA2WLE72', 'WABL9CTK8', 'WABLDKJPQ', 'WAAGMNVHS', 'WCJQY2KSM']
         }]
      },
      {
         code: 'vsan-zdom',
         name: 'vsan zdom engineers',
         membersFilters: [{
            condition: 'include',
            type: 'selected',
            // include eknauft(WAAPCHAHY), yanglo(W0145V47RAA), Mounesh(WDS8JMT0W),
            // yifanwa(WTX92HK6C), sgazit(W014FJUL2SE), exiang(WABQZCQB1), wenguangw(WAAGMNVHS),
            // lixi(WC8H2UHL3), quanxingl(U01NP81JFAT), qinkaif(W014M0JJ3HV), abhayj(WAA329J48),
            // cgadhiraju(WABQZ5LUF), neil(WGVJ12HBP), jzuo(W016VN9LMML), sriramp(WAATJ7EAH),
            // amax(WABL7HU14), prenauld(WAA319ZK2), igarewal(WAATJCM2R), pyanxing(U027ZJLEW04),
            // whuiyuan(U03LMAKD6TB), yunh(U03LB0EPNN8) all
            members: ['WAAPCHAHY', 'W0145V47RAA', 'WDS8JMT0W', 'WTX92HK6C', 'W014FJUL2SE',
               'WABQZCQB1', 'WAAGMNVHS', 'WC8H2UHL3', 'U01NP81JFAT', 'W014M0JJ3HV', 'WAA329J48',
               'WABQZ5LUF', 'WGVJ12HBP', 'W016VN9LMML', 'WAATJ7EAH', 'WABL7HU14', 'WAA319ZK2',
               'WAATJCM2R', 'U027ZJLEW04', 'U03LMAKD6TB', 'U03LB0EPNN8']
         }]
      },
      {
         code: 'vsan-fs',
         name: 'vsan vdfs engineers',
         membersFilters: [{
            condition: 'include',
            type: 'selected',
            // include aguo(WAA2ZMETS), xfan(WF4MRCQ1Z), jagnyadattat(U02P5TRU1GX),
            // rshiju(U02DGP7TTEF), sbhargo(U02LKCG6L13), xiangyu(WEC01CSN9), gracex(W012RS6KKRT),
            // wmanman(U02NYP2FMR8), sriramp(WAATJ7EAH), gmaneesh(U05AW7QJ90U), neil(WGVJ12HBP),
            // rshreesha(WQ5B4VC2H), huangxin(WAAPFKZCJ), wxinyan(WEVJ18N9X) all
            members: ['WAA2ZMETS', 'WF4MRCQ1Z', 'U02P5TRU1GX', 'U02DGP7TTEF', 'U02LKCG6L13',
               'WEC01CSN9', 'W012RS6KKRT', 'U02NYP2FMR8', 'WAATJ7EAH', 'U05AW7QJ90U', 'WGVJ12HBP',
               'WQ5B4VC2H', 'WAAPFKZCJ', 'WEVJ18N9X']
         }]
      },
      {
         code: 'vsan-clom',
         name: 'vsan clom engineers',
         membersFilters: [{
            condition: 'include',
            type: 'selected',
            // include somnaths2(U03E58K06AV), thornycrofto(WAALJ36G3), bthummar(WAAGPASLU),
            // mkothapalli(U02ECQY3YCC), haoyuez1(U03KU4PSW31), rbhuleskar(W018KD7DYL9),
            // nkandru(WGB3MNVMZ), zhxia(WHRT5SP8C), broughtonm(U0375UE17PD),
            // daingades(U03BSCCV3H6), narendrasi(W01A575R2DP) all
            members: ['U03E58K06AV', 'WAALJ36G3', 'WAAGPASLU', 'U02ECQY3YCC', 'U03KU4PSW31',
               'W018KD7DYL9', 'WGB3MNVMZ', 'WHRT5SP8C', 'U0375UE17PD', 'U03BSCCV3H6', 'W01A575R2DP']
         }]
      },
      {
         code: 'vsan-health',
         name: 'vsan health nanny engineers',
         membersFilters: [{
            condition: 'include',
            type: 'selected',
            // include yuwu(WAAPJ22V8), ckaijia(W016T23BXQE), sifanl(WAAPHLDCJ),
            // fjianan(W011WS3LJ2G), zhangal(W01431TEJ1E) all
            members: ['WAAPJ22V8', 'W016T23BXQE', 'WAAPHLDCJ', 'W011WS3LJ2G', 'W01431TEJ1E']
         }]
      }
   ]

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
      const members = await FlattenMembers(team.membersFilters)
      team.members = members
      await team.save()
      logger.info(`saved team ${team.name} members ${JSON.stringify(team.members)}`)
   }))
}

export { TeamGroup, UpdateTeamGroup }
