import {SyncClient} from '../sync.mjs';

export class WsProvider {
  constructor(callbacks) {this.client = new SyncClient(callbacks);}
  configure(config, credentials) {
    this.client.configure({enabled: config.enabled, url: config.ws.url, token: credentials.syncToken});
  }
  push() {this.client.push();}
  close() {this.client.close();}
}
