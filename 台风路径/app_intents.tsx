import { AppIntentManager, AppIntentProtocol, Widget } from 'scripting'
import { shiftSelection } from './widget_data'

export const PreviousTyphoonIntent = AppIntentManager.register({
  name: 'PreviousTyphoon',
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_params: undefined) => {
    shiftSelection(-1)
    Widget.reloadAll()
  }
})

export const NextTyphoonIntent = AppIntentManager.register({
  name: 'NextTyphoon',
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_params: undefined) => {
    shiftSelection(1)
    Widget.reloadAll()
  }
})
