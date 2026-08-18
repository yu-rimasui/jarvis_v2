declare module "twitter-text" {
  interface ParsedTweet {
    readonly valid: boolean;
    readonly weightedLength: number;
  }

  interface TwitterText {
    parseTweet(value: string): ParsedTweet;
  }

  const twitterText: TwitterText;
  export default twitterText;
}
