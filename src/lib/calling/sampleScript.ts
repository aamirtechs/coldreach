/**
 * The sample WordPress speed script offered by the "Insert WordPress
 * speed sample script" action in the Calling section (v1.43.0).
 * Adapted from the expert-backed script research pack of 2026-11-20
 * (opener, voicemail, gatekeeper and objection replies), with the
 * pack's bracketed placeholders converted to the renderer's tokens:
 * {{firstName}}, {{company}}, {{mobileScore}} and {{lcp}} fill from
 * the lead at call time, while [Your Name], [$Price] and [Day/Time]
 * stay as fill-ins for the caller. The guarantee line is included
 * only as an optional line, exactly as the pack frames it: say it
 * only if it is your real, honoured policy.
 */
export const SAMPLE_SCRIPT_NAME = "WordPress Speed, owner call";

export const SAMPLE_SCRIPT_BODY = `MAIN SCRIPT, OWNER ANSWERS

Opener (0:00 to 0:10)
"Hi, is that {{firstName}}? {{firstName}}, my name is [Your Name]. I will be honest, this is a cold call, but it is a researched one. Can I take 30 seconds to tell you why I called, and then you can tell me if it is worth carrying on or not?"

Reason and problem (0:10 to 0:30)
"Thank you. The reason I called is, before I rang, I ran your website through Google's own PageSpeed test, the mobile one, how most people find you. {{company}} scored {{mobileScore}} out of 100, and the main content took {{lcp}} seconds to show up on a phone. Google calls under two and a half seconds good, so you are at several times that. You can run the exact same test yourself and you will see the exact same number."

Agitation question (0:30 to 1:15)
"Can I ask, when someone finds you on their phone, maybe from Google Maps or an ad, and the page takes {{lcp}} seconds, what do you reckon most of them do?"
(If they say "leave" or "go elsewhere":) "That is what Google's own research says happens too, most mobile visits are given up on after about three seconds. Has anyone, you or whoever looks after the site, ever looked at the speed side of it before?"
(Mirror their last few words if they expand, then stay quiet.)

Proof (1:15 to 1:45)
"Reason I ask is, that is literally all I do. Since 2018 I have just made WordPress sites load faster. I have 121 reviews on Fiverr at 4.9 stars and 25 rated jobs on Upwork. I am happy to send you the links so you can check I am real before you pay me a penny."

Offer, anchor and risk reversal (1:45 to 2:30)
"Here is what it looks like. It is a one-off fixed price, for a site like yours it is [$Price], not an hourly rate and there is no monthly contract. I optimise the images, the caching, the code that is blocking the page, all the stuff that test flags, and you get a before and after report with the same Google test, so you can see the score move with your own eyes. Most sites I do are turned around in two to three days, and you do not have to do anything except give me access. I do the work."
(Optional, ONLY if it is your real policy: "And so the risk is not yours: if the after test does not show a real improvement, you do not pay. I can only promise that because the before and after is measured by Google's test, not by me.")

Close, default low friction (2:30 onward)
"I am not asking you to decide all that on a cold call. Would it be a bad idea if I sent you the free one-page report today, your score, what is causing it, what I would fix, and we had ten minutes on [Day] at [Time] for me to walk you through it? If you look at it and think it is not worth it, you just tell me that on the call and that is the end of it. Fair?"
(If yes:) "Perfect. Let me make sure I send it to the right place, what is the best email? That is [spell it back]. You will have the report by [time today]. And I will send a calendar invite for [Day/Time] now, could you just tap accept while we are on, so I know it landed?"

Close, warm variant (they are asking buying questions)
"If you would rather just get it done: I can book you in for [Day], it is [$Price] fixed, and you do not pay until you have seen the after report. I just need the best email for the invoice and the access details form. Shall I lock that in?"

If they need to think about it
"Of course. So I do not chase you like every other caller, is it the money, is it whether it will actually work, or is it just timing? (Answer that one thing, then:) Tell you what, I will send the report anyway, no charge, and I will check in once on [Day]. If it is a no then, I will close the file and you will not hear from me again. Deal?"

VOICEMAIL, UNDER 20 SECONDS
Leave this only when you will send the matching email the same day, subject line "Your PageSpeed score". Maximum two voicemails per prospect.
"{{firstName}}, it is [Your Name]. I ran {{company}}'s website through Google's PageSpeed test, it scored {{mobileScore}} out of 100 on mobile. I am sending you a short email now with the report, subject line 'Your PageSpeed score.' No need to call back."

GATEKEEPER VERSION
"Hi, my name is [Your Name]. Could you put me through to {{firstName}} if they are around? It is about their website. I ran a Google speed test on it this morning and found something they would probably want to know about. It will take two minutes of their time, and if it is not relevant I will leave it with you."
(If asked "are they expecting your call?":) "No, they are not expecting me, I will not pretend otherwise. I fix slow WordPress websites, and theirs scored {{mobileScore}} out of 100 on Google's mobile test. You are welcome to tell them exactly that and let them decide, or if email is better, could I have the best address to send the one-page report to?"
(If the owner is unavailable:) "No problem, when is the best time to catch {{firstName}} directly? Early morning before you open, or later in the day? Thanks, I will try then. My name is [Your Name] if they ask."`;

export const SAMPLE_SCRIPT_OBJECTIONS = `One attempt each: agree, isolate, then test-drive.

"SEND ME AN EMAIL"
"Happy to, and I will, today. So I do not send you something irrelevant: the email would just be your one-page report, your {{mobileScore}} score, what is causing it, what I would fix and the fixed price. Is that the thing you would actually want to see, or, be honest, it is fine, is 'send me an email' a polite way of saying 'not interested'?"

"WE ALREADY HAVE A WEB GUY"
"Good, you should have someone. I am not looking to replace him, I only do the speed piece, one-off, and it is the bit that often never gets to the top of a web guy's list. Quick question so I do not waste your time: has he ever mentioned your PageSpeed score, or is that something nobody has looked at? If nobody has looked, let me send the free report, you can even hand it to him. If he wants to fix it, great. If not, you have my price in writing."

"HOW MUCH DOES IT COST?" (asked early)
"Fair question, straight answer: it is fixed, one-time, between $45 and $195 depending on the size of the site. For a site like yours it would be [$Price]. No hourly billing, no monthly contract. And you would see a before and after Google report. Want me to take 30 seconds to tell you what that actually covers, or is the number itself enough for now?"

"NOT INTERESTED"
"That is fair, I know you did not ask me to call, and most people say that before they hear why I rang. Before I go, just so nobody from my side bugs you again: is it that the website side is all handled and fast enough, or is it just that cold calls are not your thing? (If 'handled':) Understood, I will close the file. If you ever run that PageSpeed test and do not like the number, you will know what to search for. Thanks for your time, {{firstName}}. (Then actually close the file.)"`;
