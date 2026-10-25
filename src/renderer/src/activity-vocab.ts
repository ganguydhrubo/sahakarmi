import * as english from "./activity-english";
import * as hinglish from "./activity-hinglish";
import { activityStyle } from "./preferences";

/** The activity vocabulary for the owner's chosen style: plain English, or Hinglish. */
export function vocab(): typeof english | typeof hinglish {
  return activityStyle() === "english" ? english : hinglish;
}
