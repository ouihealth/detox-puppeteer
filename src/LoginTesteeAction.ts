export default class LoginTestee {
  type: 'login';
  params: any;
  messageId;
  constructor(sessionId: string) {
    this.type = 'login';
    this.params = { sessionId, role: 'testee' };
    this.messageId;
  }
  async handle(response) {
    if (response.type !== 'loginSuccess') throw new Error('Unexpected response type');
  }
}
