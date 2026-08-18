import twitterText from "twitter-text";

export function xWeightedCharacterCount(value: string): number {
  return twitterText.parseTweet(value).weightedLength;
}

export function isValidXText(value: string): boolean {
  return twitterText.parseTweet(value).valid;
}
