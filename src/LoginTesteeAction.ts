export default class LoginTestee {
  type: 'login';
  params: any;
  messageId;
  constructor(sessionId: string, role: 'testee' | 'app') {
    this.type = 'login';
    this.params = { sessionId, role };
    this.messageId;
  }
  async handle(response) {
    if (response.type !== 'loginSuccess') throw new Error('Unexpected response type');
  }
}
