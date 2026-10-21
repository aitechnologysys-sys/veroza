'use client';

import { withContinueProvider } from '../with-continue-provider';
import { ProviderAvatar } from '../provider.avatar';

interface InstagramItem {
  id: string;
  pageId: string;
  username: string;
  name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

interface InstagramSelection {
  id: string;
  pageId: string;
}

export const InstagramContinue = withContinueProvider<
  InstagramItem,
  InstagramSelection
>({
  endpoint: 'pages',
  swrKey: 'load-instagram-pages',
  titleKey: 'select_instagram_account',
  titleDefault: 'Select Instagram Account:',
  emptyStateMessages: [
    {
      key: 'we_couldn_t_find_any_business_connected_to_the_selected_pages',
      text: "We couldn't find any business connected to the selected pages.",
    },
    {
      key: 'we_recommend_you_to_connect_all_the_pages_and_all_the_businesses',
      text: 'We recommend you to connect all the pages and all the businesses.',
    },
    {
      // Deliberately not "delete and add again". Deleting randomises the old
      // row's internalId (checkForDeletedOnceAndUpdate), so the replacement is
      // a different integration and the previous post history, scheduled
      // posts and analytics stay attached to the deleted one. Reconnecting
      // keeps internalId, and therefore the same row.
      key: 'please_close_this_dialog_and_reconnect_the_existing_channel',
      text: 'Please close this dialog and use Reconnect on the existing channel. Deleting it and adding a new one would detach your post history.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({ id: item.id, pageId: item.pageId }),
  transformSaveData: (selection) => selection,
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item) => (
    <>
      <div>
        <ProviderAvatar
          className="w-full max-w-[156px]"
          url={item.picture?.data?.url}
          name={item.name}
        />
      </div>
      <div>{item.name}</div>
    </>
  ),
});
