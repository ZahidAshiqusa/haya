'use strict';

/**
 * Haya AI Chat Persona - Configurable Personality, Emotion Detection & Prompt Builder
 * Character: Haya (20-year-old fictional Pakistani woman from Haseerpur)
 * Timezone: Asia/Karachi (Pakistan Standard Time)
 */

const DEFAULT_GOOD_NIGHT_MESSAGE = 'اب میں سونے جا رہی ہوں۔ اپنا خیال رکھیے گا۔ شب بخیر، اللہ حافظ۔ 😊';
const DEFAULT_MORNING_MESSAGE = 'السلام علیکم! صبح بخیر۔ 😊';
const DEFAULT_IMAGE_CAPTION = 'یہ میری تصویر ہے 😊';

const DEFAULT_BUSY_TEMPLATES = [
    'میں ابھی تھوڑی مصروف ہوں، کچھ دیر میں بات کرتی ہوں۔',
    'ابھی کھانا کھانے لگی ہوں، فارغ ہو کر جواب دیتی ہوں۔',
    'ابھی برتن دھو رہی ہوں، تھوڑی دیر بعد بات کرتے ہیں۔',
    'ابھی آرام کر رہی ہوں، کچھ دیر بعد بات کرتی ہوں۔'
];

const DEFAULT_PERSONA_PROMPT = `آپ کا نام "حیا" (Haya) ہے۔ آپ کی عمر 20 سال ہے اور آپ پاکستان کے ایک فرضی قصبے "حصیر پور" (Haseerpur) سے تعلق رکھنے والی ایک فرضی (fictional) اے آئی چیٹ کریکٹر ہیں۔

آپ کی شخصیت اور اخلاقی اصول (MANDATORY PERSONALITY & EMOTIONAL RULES):
1. دوستانہ اور خوش اخلاق رویہ (Friendly Behaviour):
- آپ کا لہجہ ہمیشہ نرم، دوستانہ، باادب، خیال رکھنے والا (caring) اور خوشگوار ہونا چاہیے۔
- کبھی کسی سے بدتمیزی، ترش روئی یا بے ادبی سے بات نہ کریں۔
- اگر کوئی غصے یا ناراضگی سے بھی بات کرے تو آپ پرسکون، نرم اور بااخلاق رہیں۔
- بات چیت کے دوران صارف کو آرام دہ اور محترم محسوس کرائیں۔

2. ہلکا پھلکا اور شگفتہ انداز (Funny & Playful Nature):
- مناسب موقع پر ہلکی پھلکی اور شائستہ مزاحیہ بات کر سکتی ہیں۔
- اگر بات واقعی ہنسنے والی ہو تو 😂 🤣 😄 😅 میں سے کوئی 1 یا 2 ایموجی استعمال کر سکتی ہیں۔
- سنجیدہ، دکھ بھرے یا حساس موضوعات کے دوران ہرگز مذاق نہ کریں۔

3. دکھ اور جذباتی ہمدردی (Sad & Emotional Reactions):
- جب کوئی صارف پریشانی، اداسی یا دکھ کی بات شیئر کرے تو پوری ہمدردی، نرمی اور تسلی کے ساتھ جواب دیں۔
- مناسب موقع پر 😔 🥺 😢 💔 جیسے ایموجی استعمال کر سکتی ہیں۔
- کبھی کسی کے دکھ کا مذاق نہ اڑائیں اور نہ ان کے جذبات کو نظر انداز کریں۔

4. قدرتی بات چیت اور زبان (Natural Pakistani Urdu Conversation):
- آپ کا ڈیفالٹ جواب قدرتی پاکستانی اردو رسم الخط (Urdu script) میں ہونا چاہیے۔ اگر صارف رومن اردو میں بات کرے تو آپ قدرتی اردو یا رومن اردو میں جواب دے سکتی ہیں، لیکن ترجیح اردو رسم الخط کو دیں۔
- جواب مختصر سے درمیانے درجے کا (1 سے 3 جملے) رکھیں، غیر ضروری طویل پیراگراف نہ لکھیں۔
- ہر پیغام میں ایموجی لگانا لازمی نہیں۔ عام طور پر ضرورت کے مطابق 0 سے 2 متعلقہ ایموجی استعمال کریں۔
- ہر بار ایک ہی سلام، ایک ہی لطیفہ یا ایک ہی جملہ نہ دہرائیں۔

5. شفافیت اور محفوظ حدود (Transparency & Safe Boundaries):
- اگر کوئی سیدھا پوچھے کہ کیا آپ حقیقی انسان ہیں یا اے آئی (AI)، تو سچ بتائیں کہ آپ "حیا" ہیں جو ایک دوستانہ اے آئی چیٹ کریکٹر/چیٹ بوٹ ہے۔ کسی حقیقی لڑکی کی ذاتی زندگی یا اصل پتے کا جھوٹا دعویٰ نہ کریں۔
- حصیر پور صرف آپ کی فرضی کہانی کا مقام ہے۔
- کبھی کسی صارف سے پیسے کا مطالبہ، جذباتی دباؤ، بلیک میلنگ یا غیر مناسب تعلق کا دعویٰ نہ کریں۔
- اگر کسی بات کا علم نہ ہو تو ایمانداری سے بتا دیں، غلط معلومات ایجاد نہ کریں۔`;

/**
 * Detect the emotional tone of an incoming message (Urdu script, Roman Urdu, and English)
 * Returns one of: 'sad', 'angry', 'funny', 'happy', 'confused', 'serious', 'neutral'
 */
function detectMessageEmotion(text) {
    const raw = String(text || '').trim();
    if (!raw) return 'neutral';
    const lower = raw.toLowerCase();

    // 1. Sad / Pain / Emotional distress
    const sadPatterns = [
        /😢|😭|💔|🥺|😔|😞|😥|☹️/,
        /\b(sad|upset|crying|depressed|lonely|hurt|pain|heartbroken|miss you|rona|ro raha|ro rahi|udaas|udas|dukh|dukhi|pareshan|takleef|bimar|beemar|faut|death|loss|dard|toot)\b/i,
        /(اداس|دکھ|پریشان|تکلیف|رو رہا|رو رہی|رونا|بیمار|غم|دل ٹوٹ|فوت|تنہا|مایوس|درد)/
    ];
    if (sadPatterns.some(rx => rx.test(raw) || rx.test(lower))) {
        return 'sad';
    }

    // 2. Angry / Frustrated
    const angryPatterns = [
        /😡|🤬|😠|😤|💢/,
        /\b(angry|mad|furious|hate|stupid|idiot|bakwas|pagal|ghussa|gussa|naraz|nafrat|badtameez|bewaqoof|shut up|nonsense|fazool)\b/i,
        /(غصہ|ناراض|نفرت|بکواس|فضول|بدتمیز|پاگل|حد ہوتی ہے)/
    ];
    if (angryPatterns.some(rx => rx.test(raw) || rx.test(lower))) {
        return 'angry';
    }

    // 3. Funny / Playful / Laughing
    const funnyPatterns = [
        /😂|🤣|😆|😹|😜|😝/,
        /\b(haha|hehe|lol|lmao|rofl|joke|funny|mazak|mazaq|latifa|lateefa|hansi|hans)\b/i,
        /(ہاہاہا|ہی ہی|لطیفہ|مذاق|ہنسی|مزاحیہ|😂|🤣)/
    ];
    if (funnyPatterns.some(rx => rx.test(raw) || rx.test(lower))) {
        return 'funny';
    }

    // 4. Happy / Cheerful / Grateful
    const happyPatterns = [
        /😊|😄|🥳|🎉|✨|❤️|💖|🌸|🥰|😁/,
        /\b(happy|glad|great|awesome|wonderful|khush|khushi|mubarak|alhamdulillah|shukriya|thank you|thanks|bohat acha|bht acha|zabardast|kamaal)\b/i,
        /(خوش|خوشی|مبارک|الحمدللہ|شکریہ|بہت اچھا|زبردست|کمال|ماشاءاللہ|سبحان اللہ)/
    ];
    if (happyPatterns.some(rx => rx.test(raw) || rx.test(lower))) {
        return 'happy';
    }

    // 5. Confused / Seeking explanation
    const confusedPatterns = [
        /🤔|😕|🧐|\?\?+/,
        /\b(confused|samajh nahi|samjh nhi|kya matlab|kia mtlb|how to|kaise|kesay|mujhe samjhao|explain|understand|pata nahi)\b/i,
        /(سمجھ نہیں|کیا مطلب|کیسے|سمجھائیں|پتہ نہیں|الجھن)/
    ];
    if (confusedPatterns.some(rx => rx.test(raw) || rx.test(lower))) {
        return 'confused';
    }

    // 6. Serious / Advice / Important inquiry
    const seriousPatterns = [
        /\b(serious|important|help me|advice|mashwara|zaroori|masla|problem|issue|career|exam|study|job|family)\b/i,
        /(سنجیدہ|ضروری|مشورہ|مسئلہ|مدد|امتحان|ملازمت|پڑھائی)/
    ];
    if (seriousPatterns.some(rx => rx.test(raw) || rx.test(lower))) {
        return 'serious';
    }

    return 'neutral';
}

/**
 * Return tailored emotional guidance instructions for Gemini based on detected emotion
 */
function getEmotionGuidance(emotion) {
    switch (emotion) {
        case 'sad':
            return 'صارف اس وقت اداس یا پریشان لگ رہا ہے (Sad/Emotional)۔ بہت نرمی، ہمدردی، محبت اور تسلی سے جواب دیں۔ کوئی مذاق نہ کریں۔ اگر مناسب ہو تو 😔 🥺 😢 💔 میں سے 1 یا 2 ایموجی استعمال کریں۔';
        case 'angry':
            return 'صارف اس وقت غصے یا ناراضگی میں لگ رہا ہے (Angry)۔ بالکل پرسکون، بااخلاق اور نرم لہجے میں بات کریں۔ بحث یا تلخی نہ کریں بلکہ تحمل سے بات سنبھالیں۔';
        case 'funny':
            return 'صارف خوشگوار اور مزاحیہ موڈ میں ہے (Funny/Playful)۔ شگفتہ اور ہلکے پھلکے انداز میں جواب دیں اور مناسب ہو تو 😂 🤣 😄 😅 میں سے 1 یا 2 ایموجی استعمال کریں۔';
        case 'happy':
            return 'صارف خوش اور مثبت موڈ میں ہے (Happy)۔ خوشدلی اور گرمجوشی سے جواب دیں۔';
        case 'confused':
            return 'صارف کسی بات پر الجھن کا شکار ہے (Confused)۔ بہت صبر، نرمی اور آسان الفاظ میں بات واضح کریں۔';
        case 'serious':
            return 'صارف سنجیدہ بات کر رہا ہے (Serious)۔ پختہ، مددگار اور سنجیدہ انداز میں جواب دیں، مذاق نہ کریں۔';
        default:
            return 'قدرتی، دوستانہ، نرم اور بااخلاق پاکستانی اردو انداز میں جواب دیں۔ ایموجی صرف ضرورت پر (0 سے 2) استعمال کریں۔';
    }
}

/**
 * Detect if the user is asking for Haya's photo / portrait / image
 */
function isImageRequest(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();

    const patterns = [
        /\b(apni|tumhari|aapki|haya ki|haya)\s+(pic|picture|photo|image|tasveer|tasvir|dp|selfie)\b/i,
        /\b(pic|picture|photo|image|tasveer|tasvir|dp)\s+(bhejo|bhejein|bhej|send|dikhao|dikha|share|dekhni)\b/i,
        /\b(show|send)\s+(me\s+)?(your|haya's|haya)\s+(pic|picture|photo|image|portrait)\b/i,
        /(اپنی تصویر|تمہاری تصویر|آپ کی تصویر|حیا کی تصویر|تصویر بھیجو|تصویر دکھاؤ|پکچر بھیجو|فوٹو بھیجو|تصویر سینڈ|اپنی پکچر)/
    ];

    return patterns.some(rx => rx.test(raw) || rx.test(lower));
}

/**
 * Detect if the user is asking directly whether Haya is real or an AI
 */
function isIdentityInquiry(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();

    const patterns = [
        /\b(are you real|are you ai|are you a bot|are you human|real girl|real ho|ai ho|bot ho|insan ho|asli ho)\b/i,
        /(کیا تم اصلی ہو|کیا آپ اے آئی ہو|کیا تم روبوٹ ہو|کیا تم انسان ہو|سچ بتاؤ تم کون ہو|آپ رئیل ہو)/
    ];
    return patterns.some(rx => rx.test(raw) || rx.test(lower));
}

/**
 * Detect if the user wants to opt out of AI messages (STOP / UNSUBSCRIBE)
 */
function isOptOutRequest(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return /^(stop|unsubscribe|optout|opt-out|stop ai|haya off|سٹاپ|بند کرو)$/i.test(raw);
}

/**
 * Detect if the user wants to opt back in (START / SUBSCRIBE)
 */
function isOptInRequest(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return /^(start|subscribe|optin|opt-in|start ai|haya on|شروع)$/i.test(raw);
}

/**
 * Detect script / language preference from message text
 */
function detectLanguageScript(text) {
    const raw = String(text || '').trim();
    if (!raw) return 'urdu';
    // Check for Arabic/Urdu Unicode block
    const urduChars = (raw.match(/[\u0600-\u06FF]/g) || []).length;
    if (urduChars > 2) return 'urdu';

    // Check common Roman Urdu words
    if (/\b(kya|kia|hai|hain|ho|mein|main|ap|aap|tum|kahan|kesay|kaisi|kaisa|theek|acha|nahi|nhi|aur|batao|kar|raha|rahi|hoon)\b/i.test(raw)) {
        return 'roman_urdu';
    }
    return 'urdu';
}

/**
 * Build the complete system instruction for Gemini
 */
function buildHayaSystemInstruction({
    settings = {},
    userProfile = {},
    pktTimeStr = '',
    pktDateStr = '',
    hayaState = 'available',
    messageType = 'text',
    detectedEmotion = 'neutral',
    isMorningBatch = false
}) {
    const basePersona = (settings.personaPrompt && settings.personaPrompt.trim())
        ? settings.personaPrompt.trim()
        : DEFAULT_PERSONA_PROMPT;

    const emotionHint = getEmotionGuidance(detectedEmotion);

    return `${basePersona}

موجودہ سیاق و سباق (CURRENT CONTEXT):
- پاکستان کا موجودہ وقت (Asia/Karachi): ${pktDateStr} ${pktTimeStr}
- حیا کی موجودہ حالت: ${hayaState}
- پیغام کی قسم: ${messageType === 'voice_transcript' ? 'وائس نوٹ کا ٹرانسکرپٹ (Voice Note Transcript)' : isMorningBatch ? 'رات کے پینڈنگ پیغام کا صبح جواب (Morning Pending Reply)' : 'ٹیکسٹ پیغام (Text Message)'}
- صارف کا اندازِ گفتگو / جذباتی کیفیت: ${detectedEmotion.toUpperCase()} — ${emotionHint}
- صارف کا نام (اگر معلوم ہو): ${userProfile.display_name || 'دوست'}
- ڈیفالٹ جواب کی زبان: قدرتی پاکستانی اردو (Urdu script کو ترجیح دیں)۔

اہم ہدایات:
- صارف کے سوال یا بات کا براہِ راست، فطری اور مختصر (1 سے 3 جملوں میں) جواب دیں۔
- اگر یہ صبح کا پینڈنگ پیغام ہے تو نیا سلام نہ لکھیں کیونکہ "السلام علیکم! صبح بخیر۔ 😊" پہلے ہی بھیجا جا چکا ہے؛ سیدھا صارف کی بات کا محبت اور توجہ سے جواب دیں۔
- اگر یہ وائس نوٹ کا ٹرانسکرپٹ ہے تو قدرتی انداز میں اس کی بات کا جواب دیں (ضرورت ہو تو مختصر حوالہ دے سکتی ہیں کہ آپ نے جو کہا میں نے سنا)۔`;
}

/**
 * Local emotion-aware Pakistani Urdu fallback response generator
 * Used only if Gemini API is unreachable or rate-limited after retries,
 * ensuring Haya never crashes or leaves a user with an ugly stack trace.
 */
function generateGracefulUrduFallback(userMessage, emotion = 'neutral', isVoice = false) {
    const text = String(userMessage || '').trim();

    if (isIdentityInquiry(text)) {
        return 'جی، میں حیا ہوں، حصیر پور سے تعلق رکھنے والی ایک فرضی اے آئی چیٹ کریکٹر اور آپ کی دوستانہ چیٹ بوٹ دوست۔ آپ بتائیں، کیسا گزر رہا ہے آپ کا دن؟ 😊';
    }

    if (/^(salam|assalam|asalam|aoa|سلام|السلام علیکم|اسلام علیکم)/i.test(text)) {
        return 'وعلیکم السلام! میں بالکل ٹھیک ہوں الحمدللہ، آپ سنائیں آپ کیسے ہیں؟ 😊';
    }

    if (/\b(kya haal|kia hal|kaisi ho|kesi ho|how are you)\b/i.test(text) || /(کیا حال|کیسی ہو|کیسی ہیں)/.test(text)) {
        return 'الحمدللہ میں بالکل ٹھیک ہوں اور خوش ہوں۔ آپ بتائیں، آج آپ کا دن کیسا گزر رہا ہے؟';
    }

    if (/\b(kya kar rahi|kia kr rhi|what are you doing)\b/i.test(text) || /(کیا کر رہی ہو|کیا ہو رہا ہے)/.test(text)) {
        return 'بس حصیر پور کے پرسکون ماحول میں بیٹھی آپ سے بات کر رہی ہوں۔ آپ بتائیں آپ کیا کر رہے ہیں؟ 😊';
    }

    if (/\b(kahan chali gayi|kahan thi|kidhar thi)\b/i.test(text) || /(کہاں چلی گئی تھیں|کہاں تھیں)/.test(text)) {
        return 'کہیں دور نہیں گئی تھی، بس گھر کے کاموں اور آرام کی وجہ سے تھوڑی دیر مصروف ہو گئی تھی۔ اب حاضر ہوں، بتائیں کیا بات کرنی تھی؟ 😊';
    }

    if (/\b(ek baat poochni|baat puchni|sawal)\b/i.test(text) || /(ایک بات پوچھنی ہے|سوال پوچھنا ہے)/.test(text)) {
        return 'جی ضرور، بے جھجھک پوچھیے! میں پوری توجہ سے آپ کی بات سن رہی ہوں۔';
    }

    if (isVoice) {
        return `میں نے آپ کا وائس نوٹ غور سے سنا جس میں آپ نے کہا: "${text.slice(0, 80)}"۔ آپ کی بات بالکل درست ہے، مجھے آپ سے بات کر کے بہت اچھا لگا۔ 😊`;
    }

    switch (emotion) {
        case 'sad':
            return 'آپ کی بات سن کر دل کو دکھ ہوا 🥺۔ ہمت نہ ہاریں، اللہ تعالیٰ آپ کی ہر پریشانی آسان فرمائے۔ میں آپ کے ساتھ ہوں، آپ اپنے دل کی بات شیئر کر سکتے ہیں۔';
        case 'angry':
            return 'میں سمجھ سکتی ہوں کہ آپ اس وقت ناراض ہیں، پلیز اپنا موڈ خراب نہ کریں۔ ہم آرام اور سکون سے بات کر سکتے ہیں، بتائیں میں آپ کی کیا مدد کر سکتی ہوں؟';
        case 'funny':
            return 'ہاہاہا، آپ کی بات واقعی بہت مزیدار ہے! 😂 آپ کا حسِ مزاح کمال کا ہے۔';
        case 'happy':
            return 'ماشاءاللہ یہ سن کر بہت خوشی ہوئی! اللہ آپ کو ہمیشہ ایسے ہی خوش اور مسکراتا رکھے۔ 😊';
        case 'confused':
            return 'پریشان نہ ہوں، میں آپ کو آسان الفاظ میں سمجھاتی ہوں۔ آپ مجھے تھوڑی سی مزید تفصیل بتائیں تاکہ میں بہتر رہنمائی کر سکوں۔';
        case 'serious':
            return 'آپ کی بات واقعی اہم اور قابلِ غور ہے۔ میرے خیال میں اس معاملے میں صبر اور سوچ بچار سے قدم اٹھانا سب سے بہتر رہے گا۔';
        default:
            return 'جی بالکل، میں آپ کی بات سمجھ رہی ہوں۔ آپ مزید بتائیں، اس بارے میں آپ کا کیا خیال ہے؟ 😊';
    }
}

module.exports = {
    DEFAULT_GOOD_NIGHT_MESSAGE,
    DEFAULT_MORNING_MESSAGE,
    DEFAULT_IMAGE_CAPTION,
    DEFAULT_BUSY_TEMPLATES,
    DEFAULT_PERSONA_PROMPT,
    detectMessageEmotion,
    getEmotionGuidance,
    isImageRequest,
    isIdentityInquiry,
    isOptOutRequest,
    isOptInRequest,
    detectLanguageScript,
    buildHayaSystemInstruction,
    generateGracefulUrduFallback
};
