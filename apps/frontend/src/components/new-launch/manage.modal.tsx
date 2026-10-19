'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AddEditModalProps } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PicksSocialsComponent } from '@gitroom/frontend/components/new-launch/picks.socials.component';
import { EditorWrapper } from '@gitroom/frontend/components/new-launch/editor';
import { SelectCurrent } from '@gitroom/frontend/components/new-launch/select.current';
import { ShowAllProviders } from '@gitroom/frontend/components/new-launch/providers/show.all.providers';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { useShallow } from 'zustand/react/shallow';
import { RepeatComponent } from '@gitroom/frontend/components/launches/repeat.component';
import { TagsComponent } from '@gitroom/frontend/components/launches/tags.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { capitalize } from 'lodash';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { CopilotPopup } from '@copilotkit/react-ui';
import { DummyCodeComponent } from '@gitroom/frontend/components/new-launch/dummy.code.component';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';
import {
  SettingsIcon,
  ChevronDownIcon,
  CloseIcon,
  TrashIcon,
  DropdownArrowSmallIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useHasScroll } from '@gitroom/frontend/components/ui/is.scroll.hook';
import { useShortlinkPreference } from '@gitroom/frontend/components/settings/shortlink-preference.component';
import dayjs from 'dayjs';
import { Button } from '@gitroom/react/form/button';
import { useClickOutside } from '@mantine/hooks';

export const ManageModal: FC<AddEditModalProps> = (props) => {
  const t = useT();
  const fetch = useFetch();
  const ref = useRef(null);
  const existingData = useExistingData();
  const [loading, setLoading] = useState(false);
  const toaster = useToaster();
  const modal = useModals();
  const [showSettings, setShowSettings] = useState(false);
  const [postNowOpen, setPostNowOpen] = useState(false);
  const postNowRef = useClickOutside<HTMLDivElement>(() => {
    setPostNowOpen(false);
  });
  const { data: shortlinkPreferenceData } = useShortlinkPreference();

  const { addEditSets, mutate, customClose, dummy } = props;

  const {
    selectedIntegrations,
    hide,
    date,
    setDate,
    repeater,
    setRepeater,
    tags,
    setTags,
    integrations,
    setSelectedIntegrations,
    locked,
    current,
    activateExitButton,
    setHide,
  } = useLaunchStore(
    useShallow((state) => ({
      hide: state.hide,
      setHide: state.setHide,
      date: state.date,
      setDate: state.setDate,
      current: state.current,
      repeater: state.repeater,
      setRepeater: state.setRepeater,
      tags: state.tags,
      setTags: state.setTags,
      selectedIntegrations: state.selectedIntegrations,
      integrations: state.integrations,
      setSelectedIntegrations: state.setSelectedIntegrations,
      locked: state.locked,
      activateExitButton: state.activateExitButton,
    }))
  );

  useEffect(() => {
    if (hide) {
      setHide(false);
    }
  }, [hide]);

  const currentIntegrationText = useMemo(() => {
    if (current === 'global') {
      return (
        <div className="flex items-center gap-[10px]">
          <div className="relative">
            <SettingsIcon size={15} className="text-white" />
          </div>
          <div>Settings</div>
        </div>
      );
    }

    const currentIntegration = integrations.find((p) => p.id === current)!;

    return (
      <div className="flex items-center gap-[10px]">
        <div className="relative">
          <img
            src={`/icons/platforms/${currentIntegration.identifier}.png`}
            className="w-[20px] h-[20px] rounded-[4px]"
            alt={currentIntegration.identifier}
          />
          <SettingsIcon
            size={15}
            className="text-white absolute -end-[5px] -bottom-[5px]"
          />
        </div>
        <div>
          {currentIntegration.name} {t('channel_settings', 'Settings')}
        </div>
      </div>
    );
  }, [current]);

  const changeCustomer = useCallback(
    (customer: string) => {
      const neededIntegrations = integrations.filter(
        (p) => p?.customer?.id === customer
      );
      setSelectedIntegrations(
        neededIntegrations.map((p) => ({
          settings: {},
          selectedIntegrations: p,
        }))
      );
    },
    [integrations]
  );

  const askClose = useCallback(async () => {
    if (!activateExitButton || dummy) {
      return;
    }

    if (
      await deleteDialog(
        t(
          'are_you_sure_you_want_to_close_this_modal_all_data_will_be_lost',
          'Are you sure you want to close this modal? (all data will be lost)'
        ),
        t('yes_close_it', 'Yes, close it!')
      )
    ) {
      if (customClose) {
        customClose();
        return;
      }
      modal.closeAll();
    }
  }, [activateExitButton, dummy]);

  const deletePost = useCallback(async () => {
    setLoading(true);
    if (
      !(await deleteDialog(
        t(
          'are_you_sure_you_want_to_delete_post',
          'Are you sure you want to delete this post?'
        ),
        t('yes_delete_it', 'Yes, delete it!')
      ))
    ) {
      setLoading(false);
      return;
    }
    await fetch(`/posts/${existingData.group}`, {
      method: 'DELETE',
    });
    mutate();
    modal.closeAll();
    return;
  }, [existingData, mutate, modal]);

  const schedule = useCallback(
    (type: 'draft' | 'now' | 'schedule' | 'update') => async () => {
      if (
        (type === 'now' || type === 'schedule') &&
        (existingData?.posts?.[0]?.state === 'PUBLISHED' ||
          (existingData?.posts?.[0]?.state === 'QUEUE' &&
            dayjs().isAfter(date.utc())))
      ) {
        const whatToDo = await new Promise((resolve) => {
          modal.openModal({
            title: 'What do you want to do?',
            children: (
              <div className="flex flex-col">
                <div className="text-[20px] mb-[20px]">
                  This post was already published, what do you want to do?
                </div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('update')}
                    >
                      Just update the post details
                    </Button>
                  </div>
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('republish')}
                    >
                      Republish the post
                    </Button>
                  </div>
                </div>
              </div>
            ),
          });
        });

        if (whatToDo === 'update') {
          type = 'update';
        }
      }

      setLoading(true);

      // Pull the local values to build the payload, but rely on the server
      // (`/posts/valid`) for the actual validation — checkValidity now lives
      // server-side so it can't be bypassed.
      const allValues = await ref.current.getAllValues();

      const integrationById = (id: string) =>
        selectedIntegrations.find((p) => p.integration.id === id);

      const group = existingData.group || makeId(10);

      const posts = allValues.map((post: any) => ({
        integration: {
          id: post.id,
        },
        group,
        settings: { ...(post.settings || {}) },
        value: post.values.map((value: any) => ({
          ...(value.id ? { id: value.id } : {}),
          content: value.content,
          delay: value.delay || 0,
          image:
            (value?.media || []).map(
              ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
                id,
                path,
                alt,
                thumbnail,
                thumbnailTimestamp,
              })
            ) || [],
        })),
      }));

      if (!dummy) {
        const checkAllValid = await (
          await fetch('/posts/valid', {
            method: 'POST',
            body: JSON.stringify({ type, posts }),
          })
        ).json();

        const focus = (id: string, where: 'fix' | 'preview') => {
          integrationById(id)?.ref?.current?.[where]?.();
        };

        const notEnoughChars = checkAllValid.filter((p: any) => p.emptyContent);

        for (const item of notEnoughChars) {
          toaster.show(
            `${capitalize(item.identifier.split('-')[0])} (${item.name}):` +
              ' ' +
              t(
                'post_needs_content_or_image',
                'Your post should have at least one character or one image.'
              ),
            'warning'
          );
          setLoading(false);
          focus(item.id, 'preview');
          return;
        }

        if (type !== 'draft') {
          for (const item of checkAllValid) {
            if (item.valid === false) {
              toaster.show(
                `${capitalize(item.identifier.split('-')[0])} (${item.name}): ${
                  item.settingsError ||
                  t('please_fix_your_settings', 'Please fix your settings')
                }`,
                'warning'
              );
              focus(item.id, 'fix');
              setLoading(false);
              setShowSettings(true);
              return;
            }

            if (item.errors !== true) {
              toaster.show(
                `${capitalize(item.identifier.split('-')[0])} (${item.name}): ${
                  item.errors
                }`,
                'warning'
              );
              focus(item.id, 'preview');
              setLoading(false);
              setShowSettings(false);
              return;
            }

            if (item.tooLong) {
              toaster.show(
                `${item.name} (${item.identifier}) ${t(
                  'post_is_too_long',
                  'post is too long, please fix it'
                )}`,
                'warning'
              );
              focus(item.id, 'preview');
              setLoading(false);
              return;
            }
          }
        }
      }

      const shortlinkPreference = shortlinkPreferenceData?.shortlink || 'ASK';

      let shortLink = false;

      if (!dummy && shortlinkPreference !== 'NO') {
        const shortLinkUrl = await (
          await fetch('/posts/should-shortlink', {
            method: 'POST',
            body: JSON.stringify({
              messages: allValues
                // platforms that remove links won't keep shortlinks either
                .filter(
                  (p: any) => !integrationById(p.id)?.integration?.stripLinks
                )
                .flatMap((p: any) => p.values.flatMap((a: any) => a.content)),
            }),
          })
        ).json();

        if (shortLinkUrl.ask) {
          if (shortlinkPreference === 'YES') {
            // Automatically shortlink without asking
            shortLink = true;
          } else {
            // ASK: Show the dialog
            shortLink = await deleteDialog(
              t(
                'shortlink_urls_question',
                'Do you want to shortlink the URLs? it will let you get statistics over clicks'
              ),
              t('yes_shortlink_it', 'Yes, shortlink it!')
            );
          }
        }
      }

      const data = {
        type,
        ...(repeater ? { inter: repeater } : {}),
        tags,
        shortLink,
        date: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
        posts,
      };

      if (dummy) {
        modal.openModal({
          title: '',
          children: <DummyCodeComponent code={data} />,
          classNames: {
            modal: 'w-[100%] bg-transparent text-textColor',
          },
          size: '100%',
          withCloseButton: false,
          closeOnEscape: true,
          closeOnClickOutside: true,
        });

        setLoading(false);
      }

      if (!dummy) {
        addEditSets
          ? addEditSets(data)
          : await fetch('/posts', {
              method: 'POST',
              body: JSON.stringify(data),
            });

        if (!addEditSets) {
          mutate();
          toaster.show(
            !existingData.integration
              ? t('added_successfully', 'Added successfully')
              : t('updated_successfully', 'Updated successfully')
          );
        }
        if (customClose) {
          setTimeout(() => {
            customClose();
          }, 2000);
        }

        if (!addEditSets) {
          modal.closeAll();
        }
      }
    },
    [ref, repeater, tags, date, addEditSets, dummy, shortlinkPreferenceData]
  );

  const publishDisabled =
    selectedIntegrations.length === 0 || loading || locked;

  return (
    <div className="w-full h-full flex-1 p-[28px] flex relative">
      <div className="flex flex-1 min-w-0 bg-calModalBg text-calInk rounded-[22px] overflow-hidden flex-col shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)]">
        <div className="flex-none flex flex-col gap-[14px] px-[28px] pt-[18px] pb-[16px] border-b border-calInk">
          <div className="flex items-center gap-[14px] border-t-[3px] border-calInk pt-[10px]">
            <h2 className="m-0 font-serif font-[600] text-[22px] leading-[1.2]">
              {t('create_post_title', 'Create Post')}
            </h2>
            <CreationMethodBadge
              creationMethod={existingData?.posts?.[0]?.creationMethod}
              size="sm"
            />
            <span aria-hidden="true" className="flex-1 h-[1px] bg-calLine" />
            {!dummy && (
              <SelectCustomer
                variant="icon-pill"
                onChange={changeCustomer}
                integrations={integrations}
              />
            )}
          </div>
          <div className="font-serif font-[500] text-[24px] xl:text-[30px] leading-[1.45] flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
            <span>{t('post_to', 'Post to')}</span>
            <div className="inline-flex items-center px-[8px] py-[5px] rounded-[30px] border border-calLine bg-calSurface">
              <PicksSocialsComponent toolTip={true} />
            </div>
            <span>{t('on_date', 'on')}</span>
            <DatePicker placement="bottom" onChange={setDate} date={date} />
            {!dummy && (
              <>
                <span aria-hidden="true" className="text-calMuted">
                  ·
                </span>
                <RepeatComponent
                  placement="bottom"
                  repeat={repeater}
                  onChange={setRepeater}
                />
              </>
            )}
            {!dummy && (
              <>
                <span aria-hidden="true" className="text-calMuted">
                  ·
                </span>
                <TagsComponent
                  placement="bottom"
                  name="tags"
                  label={t('tags', 'Tags')}
                  initial={tags}
                  onChange={(e) => {
                    setTags(e.target.value);
                  }}
                />
              </>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="flex flex-col flex-1 min-w-0 gap-[12px] px-[28px] pt-[16px] pb-[16px]">
            {!existingData.integration && <SelectCurrent />}
            <div
              className={clsx('flex-1 relative', showSettings && 'hidden')}
            >
              <div
                id="social-content"
                className="flex flex-col pe-[8px] absolute top-0 start-0 w-full h-full overflow-x-hidden overflow-y-scroll scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner"
              >
                <div className="flex flex-1 gap-[6px] flex-col">
                  <div className="flex-1 flex">
                    {!hide && <EditorWrapper totalPosts={1} value="" />}
                  </div>
                  <div
                    id="social-empty"
                    className={clsx(
                      'pb-[16px]'
                      // current !== 'global' && 'hidden'
                    )}
                  />
                </div>
              </div>
            </div>
            <div
              id="wrapper-settings"
              className={clsx(
                'select-none',
                showSettings && 'flex-1 flex',
                current === 'global' && 'hidden'
              )}
            >
              <div
                className={clsx(
                  'flex-1 flex flex-col rounded-[14px] overflow-hidden',
                  showSettings && 'bg-calModalCell'
                )}
              >
                <div
                  onClick={() => setShowSettings(!showSettings)}
                  aria-expanded={showSettings}
                  className={clsx(
                    'bg-btnPrimary rounded-[14px] h-[46px] flex-none flex items-center gap-[10px] cursor-pointer px-[16px] hover:opacity-95 transition-opacity',
                    showSettings ? '!rounded-b-none' : ''
                  )}
                >
                  <div className="flex-1 text-[14px] font-[600] text-white">
                    {currentIntegrationText}
                  </div>
                  <div>
                    <ChevronDownIcon
                      rotated={showSettings}
                      className="text-white"
                    />
                  </div>
                </div>
                <div
                  className={clsx(
                    !showSettings ? 'hidden' : 'flex-1',
                    'text-[14px] text-textColor font-[500] relative'
                  )}
                >
                  <div className="absolute start-0 top-0 w-full h-full flex flex-col overflow-x-hidden overflow-y-auto scrollbar scrollbar-thumb-newBgColorInner scrollbar-track-newColColor">
                    <div
                      id="social-settings"
                      className="flex flex-col gap-[16px] p-[16px]"
                    />
                  </div>
                </div>
                <style>
                  {`#social-settings [data-id="${current}"] {display: block !important;}`}
                </style>
              </div>
            </div>
          </div>
          <div className="w-[400px] xl:w-[470px] flex-none flex flex-col bg-calSurface border-s border-calLine">
            <div className="h-[58px] flex-none flex items-center gap-[12px] ps-[24px] pe-[18px] border-b border-calLine">
              <h3 className="m-0 flex-1 font-serif italic font-[500] text-[21px]">
                {t('post_preview', 'Post Preview')}
              </h3>
              <button
                type="button"
                onClick={askClose}
                aria-label={t('close', 'Close')}
                className="w-[40px] h-[40px] rounded-full border border-calLine bg-transparent text-calInk hover:bg-calModalCell flex items-center justify-center transition-colors"
              >
                <CloseIcon size={16} />
              </button>
            </div>
            <div className="flex-1 relative">
              <Scrollable
                scrollClasses="!pe-[20px]"
                className="absolute top-0 px-[24px] py-[20px] start-0 w-full h-full overflow-x-hidden overflow-y-scroll scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner"
              >
                <ShowAllProviders ref={ref} />
              </Scrollable>
            </div>
          </div>
        </div>
        <div className="select-none h-[80px] flex-none px-[24px] border-t border-calInk flex items-center gap-[10px]">
          {existingData?.integration && (
            <button
              onClick={deletePost}
              className="cursor-pointer h-[44px] px-[16px] rounded-full bg-calDangerSoft text-calDanger flex gap-[8px] items-center text-[14px] font-[600] hover:opacity-90 transition-opacity"
            >
              <div>
                <TrashIcon size={16} />
              </div>
              <div>{t('delete_post', 'Delete Post')}</div>
            </button>
          )}
          <span className="flex-1" />
          {!addEditSets && (
            <button
              disabled={publishDisabled}
              onClick={schedule('draft')}
              className="relative cursor-pointer disabled:cursor-not-allowed disabled:opacity-70 px-[20px] h-[44px] bg-calModalCell text-calInk hover:opacity-90 justify-center items-center flex rounded-full text-[14px] font-[600] transition-all"
            >
              {loading && (
                <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                  <div className="animate-spin h-[20px] w-[20px] border-4 border-textColor border-t-transparent rounded-full" />
                </div>
              )}
              <div className={clsx(loading && 'invisible')}>
                {t('save_as_draft', 'Save as Draft')}
              </div>
            </button>
          )}
          {addEditSets && (
            <button
              className="text-white text-[14px] font-[600] min-w-[180px] btnSub disabled:cursor-not-allowed disabled:opacity-80 outline-none gap-[8px] flex justify-center items-center h-[44px] rounded-full bg-btnPrimary hover:opacity-95 px-[22px] transition-all"
              disabled={publishDisabled}
              onClick={schedule('draft')}
            >
              Save Set
            </button>
          )}
          {!addEditSets && (
            <div ref={postNowRef} className="group relative flex">
              <button
                disabled={publishDisabled}
                onClick={schedule('schedule')}
                className={clsx(
                  'text-white relative min-w-[190px] btnSub disabled:cursor-not-allowed disabled:opacity-80 outline-none gap-[8px] flex justify-center items-center h-[44px] bg-btnPrimary hover:opacity-95 px-[22px] transition-all',
                  dummy ? 'rounded-full' : 'rounded-s-full'
                )}
              >
                {loading && (
                  <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                    <div className="animate-spin h-[20px] w-[20px] border-4 border-white border-t-transparent rounded-full" />
                  </div>
                )}
                <div
                  className={clsx(
                    'text-[14px] font-[600]',
                    loading && 'invisible'
                  )}
                >
                  {selectedIntegrations.length === 0
                    ? t('check_circles_above', 'Check the circles above')
                    : dummy
                    ? t('create_output', 'Create output')
                    : !existingData?.integration
                    ? t('add_to_calendar', 'Add to calendar')
                    : existingData?.posts?.[0]?.state === 'DRAFT'
                    ? t('schedule', 'Schedule')
                    : t('update', 'Update')}
                </div>
              </button>
              {!dummy && (
                <button
                  type="button"
                  aria-label={t('more_publish_options', 'More publish options')}
                  aria-haspopup="menu"
                  aria-expanded={postNowOpen}
                  onClick={() => setPostNowOpen(!postNowOpen)}
                  className="w-[44px] h-[44px] rounded-e-full bg-btnPrimary hover:opacity-95 border-s border-white/35 flex justify-center items-center transition-all"
                >
                  <DropdownArrowSmallIcon
                    className={clsx(
                      'text-white transition-transform',
                      postNowOpen ? 'rotate-180' : 'group-hover:rotate-180'
                    )}
                  />
                </button>
              )}

              {!dummy && (
                <div
                  role="menu"
                  className={clsx(
                    'z-[300] absolute bottom-[100%] end-0 pb-[8px]',
                    postNowOpen ? 'flex' : 'hidden group-hover:flex'
                  )}
                >
                  <div className="w-[210px] p-[6px] rounded-[14px] bg-calCard border border-calLine shadow-[0_18px_40px_-18px_rgba(0,0,0,0.45)]">
                    <button
                      role="menuitem"
                      onClick={schedule('now')}
                      disabled={publishDisabled}
                      className="w-full h-[40px] rounded-[10px] bg-calEmberSoft text-calEmberText text-start px-[12px] text-[14px] font-[600] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 transition-opacity"
                    >
                      {t('post_now', 'Post Now')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <CopilotPopup
        hitEscapeToClose={false}
        clickOutsideToClose={true}
        instructions={`
You are an assistant that help the user to schedule their social media posts,
Here are the things you can do:
- Add a new comment / post to the list of posts
- Delete a comment / post from the list of posts
- Add content to the comment / post
- Activate or deactivate the comment / post

Post content can be added using the addPostContentFor{num} function.
After using the addPostFor{num} it will create a new addPostContentFor{num+ 1} function.
`}
        labels={{
          title: t('your_assistant', 'Your Assistant'),
          initial: t(
            'assistant_initial_message',
            'Hi! I can help you to refine your social media posts.'
          ),
        }}
      />
    </div>
  );
};

const Scrollable: FC<{
  className: string;
  scrollClasses: string;
  children: ReactNode;
}> = ({ className, scrollClasses, children }) => {
  const ref = useRef(undefined);
  const hasScroll = useHasScroll(ref);
  return (
    <div className={clsx(className, hasScroll && scrollClasses)} ref={ref}>
      {children}
    </div>
  );
};
