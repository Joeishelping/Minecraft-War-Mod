// War Engine: battle chatter data. Which languages there are, which recorded line each shout plays, which lines each
// language has recordings for, and what every line says (English, for subtitles). The sounds live in the resource pack
// (sounds/war_voice/<lang>/), one sound event per line: war.voice.<lang>.<line>.
export const VOICE_KEYS = ["none", "en_us", "us_mix", "en_gb", "greek", "korean", "spanish", "hebrew", "dutch", "german", "mongolian", "russian", "italian", "hindi", "igbo", "haitian", "arabic_sy", "chinese", "maya", "aave"];
export const VOICE_NAMES = ["None (silent)", "US English", "American (US English + AAVE, mixed)", "British English", "Greek", "Korean", "Spanish", "Hebrew", "Dutch", "German", "Mongolian", "Russian", "Italian", "Hindi", "Igbo", "Haitian Creole", "Syrian Arabic (mixed)", "Chinese (Mandarin)", "Yucatec Maya", "AAVE"];
export const CALL_KEY = { "Enemy spotted!": "spotted", "Contact!": "contact", "Flanking!": "flanking", "Charge!": "charge", "Go, go, go!": "gogogo",
  "Moving up!": "moving_up", "Suppressing!": "suppressing", "I'm hit!": "hit", "Man down!": "man_down", "You're okay!": "okay", "Fall back!": "fall_back",
  "Cover me!": "cover_me", "Target down!": "target_down", "Clear!": "clear", "Hold position!": "hold", "Follow me!": "follow",
  "Medic!": "medic", "Thanks!": "thanks", "Reloading!": "reloading", "Grenade!": "grenade", "Don't shoot!": "surrender", "Taking fire!": "under_fire",
  // v9.5: replies and situation lines (US English so far; other languages stay silent on these until recorded)
  "Copy that!": "copy", "On it!": "on_it", "Nice shot!": "nice_shot", "Hang on, I got you!": "got_you", "Smoke out!": "smoke_out",
  "Breaching!": "breaching", "Wait for it...": "wait_for_it", "Open fire!": "open_fire", "Animal!": "animal", "Hands up!": "hands_up", "Mount up!": "mount_up" };
export const BASE_LINES = ["spotted", "contact", "flanking", "charge", "gogogo", "moving_up", "suppressing", "hit", "man_down", "okay", "fall_back", "cover_me", "target_down", "clear", "hold", "follow"];
export const MORE_LINES = ["under_fire", "idle_quiet", "idle_sharp", "idle_smoke", "idle_done", "idle_legs", "medic", "thanks", "surrender", "reloading", "grenade"];
export const VOICE_HAS = Object.fromEntries(["en_us", "greek", "korean", "mongolian", "hebrew", "spanish", "german", "aave"].map((l) => [l, [...BASE_LINES, ...MORE_LINES]]));   // (v6.7: recorded so far)
// v9.5: replies, situation lines, idle back-and-forth and campfire stories (recorded in US English)
export const EN_LINES = ["copy", "on_it", "nice_shot", "got_you", "smoke_out", "breaching", "wait_for_it", "open_fire", "animal", "hands_up", "mount_up",
  "q_food", "a_food", "q_quiet", "a_quiet", "q_letter", "a_letter", "story_1", "story_2", "camp_laugh", "camp_again"];
VOICE_HAS.en_us.push(...EN_LINES);
export const IDLE_ASK = { q_food: "a_food", q_quiet: "a_quiet", q_letter: "a_letter" };   // (an idle question gets its answer from a mate)
export const STORIES = ["story_1", "story_2"];
export const IDLE_LINES = ["idle_quiet", "idle_sharp", "idle_smoke", "idle_done", "idle_legs", "q_food", "q_quiet", "q_letter"];
export const LINE_INFO = {
  spotted: ["Enemy spotted!", "first sees an enemy"], contact: ["Contact!", "his squad first makes contact"],
  flanking: ["Flanking!", "the squad sends men round the side"], charge: ["Charge!", "the squad assaults"],
  gogogo: ["Go, go, go!", "the assault goes in"], moving_up: ["Moving up!", "moving forward under fire, reinforcing, a medic on his way"],
  suppressing: ["Suppressing!", "pinning the enemy down, covering a mate who reloads"], hit: ["I'm hit!", "wounded"],
  man_down: ["Man down!", "a squad mate falls nearby"], okay: ["You're okay!", "a medic revives someone"],
  fall_back: ["Fall back!", "shaken, or the squad pulls back"], cover_me: ["Cover me!", "bounding forward while mates cover"],
  target_down: ["Target down!", "the man he shot goes down"], clear: ["Clear!", "the fight is over"],
  hold: ["Hold position!", "the march arrives"], follow: ["Follow me!", "a march starts"],
  under_fire: ["Taking heavy fire!", "shot at, pinned down"], idle_quiet: ["Sector's locked down...", "idle"],
  idle_sharp: ["Head on a swivel, stay frosty.", "idle"], idle_smoke: ["Anyone got a dart?", "idle (tired)"],
  story: ["(tells a story)", "at a campfire, now and then"],
  idle_done: ["So done with this deployment...", "idle (tired)"], idle_legs: ["My legs are shot...", "idle (tired)"],
  medic: ["Medic! I'm hit!", "down, and no medic coming"], thanks: ["Good looking out, brother.", "just revived"],
  surrender: ["Don't shoot!", "surrendering"], reloading: ["Dry, cover me while I swap!", "reloading in a fight"],
  grenade: ["Frag out! Get down!", "throwing a grenade / molotov, or one lands near him"],
  copy: ["Copy that!", "answering \"Hold position!\" / \"Follow me!\""], on_it: ["On it!", "answering \"Cover me!\""],
  nice_shot: ["Nice shot!", "a mate's man goes down"], got_you: ["Hang on, I got you!", "a mate is hit near him"],
  smoke_out: ["Smoke out!", "throwing smoke"], breaching: ["Breaching! Breaching!", "the stack goes through the door"],
  wait_for_it: ["Wait for it...", "an ambush is set (whispered)"], open_fire: ["Now! Open fire!", "the ambush is sprung"],
  animal: ["Animal! Put it down!", "a man-eater (World Animals) comes at them"], hands_up: ["Hands where I can see 'em!", "an enemy surrenders near him"],
  mount_up: ["Mount up!", "the Mount up order"],
  q_food: ["What's the first thing you're eating when we get home?", "idle"], a_food: ["My mom's cooking. Nothing else even comes close.", "idle (answer)"],
  q_quiet: ["It's too quiet out here.", "idle"], a_quiet: ["Don't jinx it, man.", "idle (answer)"],
  q_letter: ["You write home yet?", "idle"], a_letter: ["Every night. Never send 'em, though.", "idle (answer)"],
  story_1: ["(the night-watch pig story)", "at a campfire"], story_2: ["(grandpa's boots story)", "at a campfire"],
  camp_laugh: ["No way. No way that happened!", "after a story"], camp_again: ["You tell that one every single time.", "after a story"],
};
