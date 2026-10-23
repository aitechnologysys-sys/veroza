'use client';

import { withContinueProvider } from '../with-continue-provider';
import { ProviderAvatar } from '../provider.avatar';

interface FacebookItem {
  id: string;
  username: string;
  name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

export const FacebookContinue = withContinueProvider<FacebookItem, string>({
  endpoint: 'pages',
  swrKey: 'load-facebook-pages',
  titleKey: 'select_page',
  titleDefault: 'Select Page:',
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
  getSelectionValue: (item) => item.id,
  transformSaveData: (selection) => ({ page: selection }),
  isSelected: (item, selection) => selection === item.id,
  renderItem: (item) => (
    <>
      <div>
        <ProviderAvatar url={item.picture?.data?.url} name={item.name} />
      </div>
      <div>{item.name}</div>
    </>
  ),
});
