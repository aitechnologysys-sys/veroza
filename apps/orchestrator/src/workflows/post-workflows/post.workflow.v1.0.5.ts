import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import {
  ActivityFailure,
  ApplicationFailure,
  startChild,
  proxyActivities,
  sleep,
  defineSignal,
  setHandler,
  patched,
} from '@temporalio/workflow';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { capitalize, sortBy } from 'lodash';
import { PostResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { publishedNotification } from './published.notification';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { TypedSearchAttributes } from '@temporalio/common';
import { postId as postIdSearchParam } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';

const proxyTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue,
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });
};

const {
  getPostsList,
  getPost,
  inAppNotification,
  changeState,
  updatePost,
  sendWebhooks,
  isCommentable,
} = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

const poke = defineSignal('poke');

// Patch marker: a live post is recorded outside the publish retry loop, so a
// failure while recording can no longer publish it a second time.
const RECORD_WITHOUT_REPUBLISH = 'record-published-without-republish';
// Must outlast the missing-post sweeper's 2-day look-back (see
// recordPublished).
const RECORD_RETRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const RECORD_RETRY_INTERVAL = '10 minutes';

const iterate = Array.from({ length: 5 });

export async function postWorkflowV105({
  taskQueue,
  postId,
  organizationId,
  postNow = false,
}: {
  taskQueue: string;
  postId: string;
  organizationId: string;
  postNow?: boolean;
}) {
  // Dynamic task queue, for concurrency
  const {
    postSocial,
    postComment,
    getIntegrationById,
    refreshTokenWithCause,
    internalPlugs,
    globalPlugs,
    processInternalPlug,
    processPlug,
  } = proxyTaskQueue(taskQueue);

  let poked = false;
  setHandler(poke, () => {
    poked = true;
  });

  const startTime = new Date();
  // get all the posts and comments to post
  const firstPost = await getPost(organizationId, postId);

  // in case doesn't exists for some reason, fail it
  if (!firstPost) {
    await changeState(postId, 'ERROR', 'No Post');
    return;
  }

  if (!postNow && firstPost.state !== 'QUEUE') {
    await changeState(firstPost.id, 'ERROR', 'Already posted', [firstPost]);
    return;
  }

  // if it's a repeatable post, we should ignore this.
  if (!postNow) {
    await sleep(
      dayjs(firstPost.publishDate).isBefore(dayjs())
        ? 0
        : dayjs(firstPost.publishDate).diff(dayjs(), 'millisecond')
    );
  }

  const postsListBefore = await getPostsList(organizationId, postId);
  const [post] = postsListBefore;

  if (!post) {
    await changeState(postId, 'ERROR', 'No Post');
    return;
  }

  // if refresh is needed from last time, let's inform the user
  if (post.integration?.refreshNeeded) {
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please enable it and try again.`,
      true,
      false,
      'info'
    );

    await changeState(
      postsListBefore[0].id,
      'ERROR',
      'Refresh channel needed',
      postsListBefore
    );
    return;
  }

  // if it's disabled, inform the user
  if (post.integration?.disabled) {
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because it's disabled. Please enable it and try again.`,
      true,
      false,
      'info'
    );

    await changeState(
      postsListBefore[0].id,
      'ERROR',
      'Channel disabled',
      postsListBefore
    );
    return;
  }

  // Do we need to post comment for this social?
  const toComment: boolean =
    postsListBefore.length === 1
      ? false
      : await isCommentable(post.integration);

  const postsList = toComment ? postsListBefore : [postsListBefore[0]];

  // list of all the saved results
  const postsResults: PostResponse[] = [];

  // send notification on a sucessful post. Same activity call whatever the
  // result (only the text differs: published, pending verification, or
  // published with a warning such as a YouTube thumbnail that was not
  // applied), so running workflows replay fine.
  const notifyPublished = () => {
    const notice = publishedNotification(
      capitalize(post.integration.providerIdentifier),
      postsResults[0]
    );
    return inAppNotification(
      post.integration.organizationId,
      notice.subject,
      notice.message,
      true,
      true,
      notice.type
    );
  };

  // Records a post or comment that is already live. Runs outside the publish
  // retry loop: inside it, any failure here (even of this database write)
  // re-ran postSocial/postComment and published a second copy. updatePost is
  // idempotent, so it is retried for longer than the missing-post sweeper
  // looks back (QUEUE posts with a publishDate in the last 2 days): while
  // this workflow is open the sweeper only pokes it, whereas a closed run
  // would be started again and publish again.
  const recordPublished = async (index: number) => {
    const deadline = Date.now() + RECORD_RETRY_WINDOW_MS;
    while (true) {
      try {
        await updatePost(
          postsList[index].id,
          postsResults[index].postId,
          postsResults[index].releaseURL
        );
        break;
      } catch (err) {
        if (Date.now() >= deadline) {
          // Outside the sweeper window by now, so no new run will publish it
          // again; the post stays QUEUE although it is live.
          return;
        }
        await sleep(RECORD_RETRY_INTERVAL);
      }
    }

    if (index === 0) {
      try {
        await notifyPublished();
      } catch (err) {
        // Already retried by Temporal; a missing notification is never worth
        // a second publication.
      }
    }
  };

  // iterate over the posts
  for (let i = 0; i < postsList.length; i++) {
    const before = postsResults.length;
    let published = false;
    // this is a small trick to repeat an action in case of token refresh
    for (const _ of iterate) {
      try {
        // first post the main post
        if (i === 0) {
          postsResults.push(
            ...(await postSocial(post.integration as Integration, [
              postsList[i],
            ]))
          );

          // then post the comments if any
        } else {
          if (postsList[i].delay) {
            await sleep(60000 * Math.max(0, Number(postsList[i].delay ?? 0)));
          }

          postsResults.push(
            ...(await postComment(
              postsResults[0].postId,
              postsResults.length === 1
                ? undefined
                : postsResults[i - 1].postId,
              post.integration,
              [postsList[i]]
            ))
          );
        }

        // It is live: leave the retry loop before anything else can fail in
        // it. Checked here, not at the top of the workflow, so runs that were
        // sleeping until their publish date when this shipped get it too;
        // histories that already went past this point replay the old path.
        if (patched(RECORD_WITHOUT_REPUBLISH)) {
          published = true;
          break;
        }

        // mark post as successful
        await updatePost(
          postsList[i].id,
          postsResults[i].postId,
          postsResults[i].releaseURL
        );

        if (i === 0) {
          await notifyPublished();
        }

        // break the current while to move to the next post
        break;
      } catch (err) {
        // if token refresh is needed, do it and repeat
        if (
          err instanceof ActivityFailure &&
          err.cause instanceof ApplicationFailure &&
          err.cause.type === 'refresh_token'
        ) {
          const refresh = await refreshTokenWithCause(
            post.integration,
            err?.cause?.message || ''
          );
          if (!refresh || !refresh.accessToken) {
            await changeState(postsList[0].id, 'ERROR', err, postsList);
            return false;
          }

          post.integration.token = refresh.accessToken;
          continue;
        }

        // for other errors, change state and inform the user if needed
        await changeState(postsList[0].id, 'ERROR', err, postsList);

        // specific case for bad body errors
        if (
          err instanceof ActivityFailure &&
          err.cause instanceof ApplicationFailure &&
          err.cause.type === 'bad_body'
        ) {
          await inAppNotification(
            post.organizationId,
            `Error posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            } for ${post?.integration?.name}`,
            `An error occurred while posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            }${err?.cause?.message ? `: ${err?.cause?.message}` : ``}`,
            true,
            false,
            'fail'
          );
          return false;
        }
      }
    }

    if (postsResults.length === before) {
      // all retries exhausted without success
      return false;
    }

    if (published) {
      await recordPublished(i);
    }
  }

  // send webhooks for the post
  await sendWebhooks(
    postsResults[0].postId,
    post.organizationId,
    post.integration.id
  );

  // load internal plugs like repost by other users
  const internalPlugsList = await internalPlugs(
    post.integration,
    JSON.parse(post.settings)
  );

  // load global plugs, like repost a post if it gets to a certain number of likes
  const globalPlugsList = (await globalPlugs(post.integration)).reduce(
    (all, current) => {
      for (let i = 1; i <= current.totalRuns; i++) {
        all.push({
          ...current,
          delay: current.delay * i,
        });
      }

      return all;
    },
    []
  );

  // Check if the post is repeatable
  const repeatPost = !post.intervalInDays
    ? []
    : [
        {
          type: 'repeat-post',
          delay:
            post.intervalInDays * 24 * 60 * 60 * 1000 -
            (new Date().getTime() - startTime.getTime()),
        },
      ];

  // Sort all the actions by delay, so we can process them in order
  const list = sortBy(
    [...internalPlugsList, ...globalPlugsList, ...repeatPost],
    'delay'
  );

  // process all the plugs in order, we are using while because in some cases we need to remove items from the list
  while (list.length > 0) {
    // get the next to process
    const todo = list.shift();

    // wait for the delay
    await sleep(Math.max(0, Number(todo.delay ?? 0)));

    // process internal plug
    if (todo.type === 'internal-plug') {
      for (const _ of iterate) {
        try {
          await processInternalPlug({ ...todo, post: postsResults[0].postId });
        } catch (err) {
          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'refresh_token'
          ) {
            const refresh = await refreshTokenWithCause(
              await getIntegrationById(organizationId, todo.integration),
              err?.cause?.message || ''
            );
            if (!refresh || !refresh.accessToken) {
              break;
            }

            continue;
          }

          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'bad_body'
          ) {
            break;
          }

          continue;
        }
        break;
      }
    }

    // process global plug
    if (todo.type === 'global') {
      for (const _ of iterate) {
        try {
          const process = await processPlug({
            ...todo,
            postId: postsResults[0].postId,
          });
          if (process) {
            const toDelete = list
              .reduce((all, current, index) => {
                if (current.plugId === todo.plugId) {
                  all.push(index);
                }

                return all;
              }, [])
              .reverse();

            for (const index of toDelete) {
              list.splice(index, 1);
            }
          }
        } catch (err) {
          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'refresh_token'
          ) {
            const refresh = await refreshTokenWithCause(
              post.integration,
              err?.cause?.message || ''
            );
            if (!refresh || !refresh.accessToken) {
              break;
            }

            continue;
          }

          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'bad_body'
          ) {
            break;
          }

          continue;
        }

        break;
      }
    }

    // process repeat post in a new workflow, this is important so the other plugs can keep running
    if (todo.type === 'repeat-post') {
      await startChild(postWorkflowV105, {
        parentClosePolicy: 'ABANDON',
        args: [
          {
            taskQueue,
            postId,
            organizationId,
            postNow: true,
          },
        ],
        workflowId: `post_${post.id}_${makeId(10)}`,
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: postIdSearchParam,
            value: postId,
          },
        ]),
      });
    }
  }
}
