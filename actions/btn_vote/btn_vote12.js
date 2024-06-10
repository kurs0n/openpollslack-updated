import { Mutex } from "async-mutex";
export const btn_vote12 = (app,mutexes,votesCol,getInfos,buildInfosBlocks,buildMenu)=>{
    app.action('btn_vote12', async ({ action, ack, body, context }) => {
        await ack();
      
        if (
          !body
          || !action
          || !body.user
          || !body.user.id
          || !body.message
          || !body.message.blocks
          || !body.message.ts
          || !body.channel
          || !body.channel.id
        ) {
          console.log('error');
          return;
        }
      
        const user_id = body.user.id;
        const message = body.message;
        let blocks = message.blocks;
      
        const channel = body.channel.id;
      
        let value = JSON.parse(action.value);
      
        if (!mutexes.hasOwnProperty(`${message.team}/${channel}/${message.ts}`)) {
          mutexes[`${message.team}/${channel}/${message.ts}`] = new Mutex();
        }
      
        let release = null;
        let countTry = 0;
        do {
          ++countTry;
      
          try {
            release = await mutexes[`${message.team}/${channel}/${message.ts}`].acquire();
          } catch (e) {
            console.log(`[Try #${countTry}] Error while attempt to acquire mutex lock.`, e)
          }
        } while (!release && countTry < 3);
      
        if (release) {
          try {
      
            let isClosed = false
            try {
              const data = await closedCol.findOne({ channel, ts: message.ts });
              isClosed = data !== null && data.closed;
            } catch {}
      
            if (isClosed) {
              await app.client.chat.postEphemeral({
                token: context.botToken,
                channel: body.channel.id,
                user: body.user.id,
                attachments: [],
                text: "You can't change your votes on closed poll.",
              });
              return;
            }
      
            let poll = null;
            const data = await votesCol.findOne({ channel: channel, ts: message.ts });
            if (data === null) {
              await votesCol.insertOne({
                team: message.team,
                channel,
                ts: message.ts,
                votes: {},
              });
              poll = {};
              for (const b of blocks) {
                if (
                  b.hasOwnProperty('elements')
                  && b.elements[0].hasOwnProperty('value')
                ) {
                  const val = JSON.parse(b.elements[0].value);
                  poll[val.id] = val.voters ? val.voters : [];
                }
              }
              await votesCol.updateOne({
                channel,
                ts: message.ts,
              }, {
                $set: {
                  votes: poll,
                }
              });
            } else {
              poll = data.votes;
            }
      
            const isHidden = await getInfos(
              'hidden',
              blocks, 
              {
                team: message.team,
                channel,
                ts: message.ts,
              },
            )
      
            let button_id = 3 + (value.id * 2);
            let context_id = 3 + (value.id * 2) + 1;
            let blockBtn = blocks[button_id];
            let block = blocks[context_id];
            let voters = value.voters ? value.voters : [];
      
            let removeVote = false;
            for (const vote of poll[value.id]){
              if (vote.userId == user_id){
                removeVote = true;
              }
            }
      
            let alreadyVoted = false;

            for (const question in poll) {
                poll[question].forEach(async item => {
                  if (item.userId === user_id && item.points === 12 && question != value.id) {
                    console.log(`Match found in question ${question}:`, item);
                    alreadyVoted = true;
                  }
                });

                if (alreadyVoted) {
                  await app.client.chat.postEphemeral({
                      token: context.botToken,
                      channel: channel,
                      user: body.user.id,
                      attachments: [],
                      text: "You can't vote anymore for 12 points. Remove a vote to choose another option.",
                  });
                  release();
                  return;
              }
            }
      
            if (removeVote) {
              poll[value.id] = poll[value.id].filter(temp => temp.userId != user_id);
              
            } else {
              poll[value.id].push({userId: user_id,points: 12});

              let question = ''
              if (value.id == 0){
                question = blocks[3].text.text
              }
              else {
                question = blocks[ (4 + (value.id ) * 4) - 1].text.text
              }

              await app.client.chat.postEphemeral({
                token: context.botToken,
                channel: channel,
                user: body.user.id,
                attachments: [],
                text: `You've vote for 12 points on option ${question}`,
            });
            }
      
            for (const i in blocks) {
              let b = blocks[i];
              if (
                b.hasOwnProperty('elements')
                && b.elements[0].hasOwnProperty('value')
              ) {
                let val = JSON.parse(b.elements[0].value);
                if (!val.hasOwnProperty('voters')) {
                  val.voters = [];
                }
      
                val.voters = poll[val.id];
                let newVoters = '';
      
                if (isHidden) {
                  newVoters = 'Wait for reveal';
                } else if (poll[val.id].length === 0) {
                  newVoters = 'No votes';
                } else {
                  newVoters = '';
                  for (const voter of poll[val.id]) {
                    if (!val.anonymous) {
                      newVoters += `<@${voter.userId}> points: ${voter.points}, `;
                    }
                  }
      
                  newVoters += poll[val.id].length +' ';
                  if (poll[val.id].length === 1) {
                    newVoters += 'vote';
                  } else {
                    newVoters += 'votes';
                  }
                }
      
                // sum of points
                let sum = 0;
                for(const vote of poll[val.id]){ 
                  sum+=vote.points;
                }
                
                let amount_of_votes = poll[val.id].length
                blocks[i].elements[0].value = JSON.stringify(val);
                const nextI = ''+(parseInt(i)+1);
                if (blocks[nextI].hasOwnProperty('elements')) {
                  if(isHidden){ 
                    blocks[nextI].elements[0].text = newVoters + `, votes: ${amount_of_votes}`;
                  } else {
                    blocks[nextI].elements[0].text = newVoters + ", sum: "+sum;
                  }
                }
              }
            }
      
            const infosIndex = blocks.findIndex(el => el.type === 'context' && el.elements)
            blocks[infosIndex].elements = await buildInfosBlocks(
              blocks,
              {
                team: message.team,
                channel,
                ts: message.ts,
              }
            );
            blocks[0].accessory.option_groups[0].options =
              await buildMenu(blocks, {
                team: message.team,
                channel,
                ts: message.ts,
              });
      
            await votesCol.updateOne({
              channel,
              ts: message.ts,
            }, {
              $set: {
                votes: poll,
              }
            });
      
            await app.client.chat.update({
              token: context.botToken,
              channel: channel,
              ts: message.ts,
              blocks: blocks,
              text: message.text,
            });
          } catch (e) {
            console.error(e);
            await app.client.chat.postEphemeral({
              token: context.botToken,
              channel: body.channel.id,
              user: body.user.id,
              attachments: [],
              text: 'An error occurred during vote processing. Please try again in few seconds.',
            });
          } finally {
            release();
          }
        } else {
          await app.client.chat.postEphemeral({
            token: context.botToken,
            channel: body.channel.id,
            user: body.user.id,
            attachments: [],
            text: 'An error occurred during vote processing. Please try again in few seconds.',
          });
        }
      });
      
};
