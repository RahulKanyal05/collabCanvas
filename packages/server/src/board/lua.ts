import { Redis } from 'ioredis';

export const SEQUENCE_LUA_SCRIPT = `
local seq = redis.call('INCR', KEYS[1])
local payload = cjson.encode({
  seq = seq,
  boardId = ARGV[1],
  op = cjson.decode(ARGV[2]),
  serverTimestamp = tonumber(ARGV[3])
})
local streamId = redis.call('XADD', KEYS[2], '*', 'seq', tostring(seq), 'payload', payload)
redis.call('PUBLISH', KEYS[3], payload)
return { seq, streamId, payload }
`;

export class LuaSequencer {
  private sha: string | null = null;

  constructor(private redis: Redis) {}

  async init(): Promise<void> {
    try {
      this.sha = await this.redis.script('LOAD', SEQUENCE_LUA_SCRIPT) as string;
    } catch (err) {
      // In-memory mocks or testing environments might not support SCRIPT LOAD
      this.sha = null;
    }
  }

  async execute(
    boardId: string,
    opJson: string,
    serverTimestamp: number
  ): Promise<{ seq: number; streamId: string; payload: string }> {
    const seqKey = `board:${boardId}:seq`;
    const streamKey = `board:${boardId}:ops`;
    const channelKey = `board:${boardId}:ops`;

    if (this.sha) {
      try {
        const result = (await this.redis.evalsha(
          this.sha,
          3,
          seqKey,
          streamKey,
          channelKey,
          boardId,
          opJson,
          serverTimestamp.toString()
        )) as [number, string, string];
        return { seq: result[0], streamId: result[1], payload: result[2] };
      } catch (err: any) {
        if (err?.message?.includes('NOSCRIPT')) {
          this.sha = await this.redis.script('LOAD', SEQUENCE_LUA_SCRIPT) as string;
          const result = (await this.redis.evalsha(
            this.sha,
            3,
            seqKey,
            streamKey,
            channelKey,
            boardId,
            opJson,
            serverTimestamp.toString()
          )) as [number, string, string];
          return { seq: result[0], streamId: result[1], payload: result[2] };
        }
        throw err;
      }
    }

    const result = (await this.redis.eval(
      SEQUENCE_LUA_SCRIPT,
      3,
      seqKey,
      streamKey,
      channelKey,
      boardId,
      opJson,
      serverTimestamp.toString()
    )) as [number, string, string];
    return { seq: result[0], streamId: result[1], payload: result[2] };
  }
}
