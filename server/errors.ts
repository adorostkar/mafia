import type { ErrorCode } from "../shared/game.js";

export class GameError extends Error {
  constructor(
    public code: ErrorCode,
    public status = 400,
  ) {
    super(code);
  }
}
