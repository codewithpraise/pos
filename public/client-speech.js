// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - AI SPEECH COACH & CONVERSATIONAL NLP
// Web Speech API client-side analytics with voice POS commands
// ============================================================================

class SpeechCoach {
  constructor(onTranscriptUpdate, onMetricsUpdate, onVoiceCommand) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onMetricsUpdate = onMetricsUpdate;
    this.onVoiceCommand = onVoiceCommand; // callback when a voice checkout command matches
    
    this.recognition = null;
    this.isRecording = false;
    this.startTime = null;
    this.wordCount = 0;
    this.fillerWordsCount = 0;
    this.sentimentScore = 0; // Cumulative score: positive words (+1), negative words (-1)
    
    // Config list of English filler words
    this.fillers = ['um', 'uh', 'ah', 'like', 'basically', 'you know', 'actually', 'literally'];
    
    // Positive/Negative sentiment vocabulary maps
    this.posVocabulary = ['good', 'great', 'awesome', 'perfect', 'thank', 'thanks', 'excellent', 'fantastic', 'wonderful', 'please', 'happy', 'love'];
    this.negVocabulary = ['bad', 'slow', 'wrong', 'no', 'problem', 'error', 'hate', 'terrible', 'expensive', 'cancel', 'fake', 'stolen', 'broken', 'delay'];
    
    this.init();
  }

  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[SpeechCoach] SpeechRecognition API is not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isRecording = true;
      this.startTime = Date.now();
      this.wordCount = 0;
      this.fillerWordsCount = 0;
      this.sentimentScore = 0;
      console.log('[SpeechCoach] Capturing audio from microphone...');
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
          this.analyzeSentence(event.results[i][0].transcript);
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      this.onTranscriptUpdate(finalTranscript || interimTranscript);
    };

    this.recognition.onerror = (event) => {
      console.error('[SpeechCoach] Recognition error:', event.error);
      this.isRecording = false;
      this.onMetricsUpdate({ status: 'ERROR: ' + event.error });
    };

    this.recognition.onend = () => {
      this.isRecording = false;
      console.log('[SpeechCoach] Microphone session closed.');
    };
  }

  toggleRecording() {
    if (!this.recognition) {
      this.onTranscriptUpdate('Speech Coach is not supported in this browser. Please use Chrome/Edge under a secure HTTPS origin context.');
      this.onMetricsUpdate({ status: 'UNSUPPORTED' });
      return;
    }

    if (this.isRecording) {
      this.recognition.stop();
      this.isRecording = false;
    } else {
      try {
        this.recognition.start();
      } catch (err) {
        console.error('[SpeechCoach] Failed to start:', err);
      }
    }
  }

  analyzeSentence(sentence) {
    const cleanSentence = sentence.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
    const words = cleanSentence.split(/\s+/).filter(w => w.length > 0);
    
    if (words.length === 0) return;

    // 1. Calculate WPM (Words Per Minute)
    this.wordCount += words.length;
    const durationMins = (Date.now() - this.startTime) / 60000;
    const wpm = durationMins > 0 ? Math.round(this.wordCount / durationMins) : 0;

    // 2. Count Fillers
    words.forEach(word => {
      if (this.fillers.includes(word)) {
        this.fillerWordsCount++;
      }
      
      // 3. Score Sentiment
      if (this.posVocabulary.includes(word)) {
        this.sentimentScore += 1;
      }
      if (this.negVocabulary.includes(word)) {
        this.sentimentScore -= 1;
      }
    });

    // 4. Voice POS commands parser
    // Syntax e.g. "add espresso", "add croissant", "add muffin", "void checkout"
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i] === 'add') {
        const itemRequest = words[i+1];
        this.onVoiceCommand('add', itemRequest);
      }
      if (words[i] === 'remove' || words[i] === 'delete') {
        const itemRequest = words[i+1];
        this.onVoiceCommand('remove', itemRequest);
      }
    }
    if (words.includes('pay') || words.includes('checkout') || words.includes('charge')) {
      this.onVoiceCommand('pay', null);
    }

    // 5. Categorize Sentiment and Risk
    let sentimentLabel = 'NEUTRAL';
    if (this.sentimentScore > 1) sentimentLabel = 'POSITIVE';
    if (this.sentimentScore < -1) sentimentLabel = 'FRICTION';

    let riskLabel = 'LOW';
    if (this.sentimentScore < -2 || this.fillerWordsCount > 8) riskLabel = 'MEDIUM';
    if (words.includes('fraud') || words.includes('stolen') || words.includes('fake') || words.includes('override')) {
      riskLabel = 'CRITICAL RISK';
    }

    // 6. Push metrics back to UI
    this.onMetricsUpdate({
      wpm: wpm,
      fillerCount: this.fillerWordsCount,
      sentiment: sentimentLabel,
      risk: riskLabel,
      durationMs: Date.now() - this.startTime
    });
  }
}

window.SpeechCoach = SpeechCoach;
