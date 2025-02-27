class AudioEffects {
    constructor(audioContext) {
        this.audioContext = audioContext;
        
        // Initialize input and output nodes
        this.input = this.audioContext.createGain();
        this.output = this.audioContext.createGain();
        this.dryGain = this.audioContext.createGain();
        this.dryGain.gain.value = 1.0;

        // Create delay effect
        this.delayNode = this.audioContext.createDelay(4.0); // Max 4 seconds
        this.delayNode.delayTime.value = 0.3; // 300ms default
        this.delayFeedback = this.audioContext.createGain();
        this.delayFeedback.gain.value = 0.4;
        this.delayWetGain = this.audioContext.createGain();
        this.delayWetGain.gain.value = 0.0;

        // Create reverb effect
        this.convolver = this.audioContext.createConvolver();
        this.reverbWetGain = this.audioContext.createGain();
        this.reverbWetGain.gain.value = 0.0;

        // Initialize sync settings
        this.syncMode = 'free';
        this.tempo = 120;  // BPM

        // Connect nodes for delay
        this.input.connect(this.dryGain);
        this.dryGain.connect(this.output);

        // Delay connections
        this.input.connect(this.delayNode);
        this.delayNode.connect(this.delayWetGain);
        this.delayWetGain.connect(this.output);
        
        // Feedback loop
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);

        // Reverb connections
        this.input.connect(this.convolver);
        this.convolver.connect(this.reverbWetGain);
        this.reverbWetGain.connect(this.output);

        // Generate impulse response for reverb
        this.generateImpulseResponse();
    }

    connectInput(node) {
        // Connect input to the effects chain
        node.connect(this.input);
    }

    connectOutput(node) {
        // Connect output to the destination
        this.output.connect(node);
    }

    setDelayTime(ms) {
        // If in 'free' mode, set delay time directly
        if (this.syncMode === 'free') {
            const seconds = Math.min(4.0, Math.max(0, ms / 1000));
            this.delayNode.delayTime.setValueAtTime(seconds, this.audioContext.currentTime);
            this.updateDelayDisplay(ms);
        }
    }

    setDelaySync(mode) {
        this.syncMode = mode;
        console.log("Set delay sync mode to:", mode);
        
        // If switching to free mode, don't update delay time yet
        if (mode === 'free') {
            document.getElementById('delay-time').disabled = false;
            return;
        }
        
        // If switching to a sync mode, disable the manual time control
        document.getElementById('delay-time').disabled = true;
        
        // Calculate the delay time based on sync mode and tempo
        const delayTime = this.calculateSyncedDelayTime(mode, this.tempo);
        this.delayNode.delayTime.setValueAtTime(delayTime, this.audioContext.currentTime);
        
        // Update display
        this.updateDelayDisplay(delayTime * 1000);
    }

    calculateSyncedDelayTime(mode, bpm) {
        // Calculate delay time based on sync mode and tempo
        if (mode === 'free') return this.delayNode.delayTime.value;
        
        // Basic formula: (60 / BPM) * (beats per measure)
        const secondsPerBeat = 60 / bpm;
        
        // Handle the various sync modes
        if (mode.includes('/')) {
            const [numerator, denominator] = mode.split('/').map(n => parseInt(n, 10));
            
            // Standard note values (1/4, 1/8, etc)
            if (denominator > 0) {
                // For normal divisions, we use 4/denominator (assuming 4/4 time)
                return secondsPerBeat * (4 * numerator / denominator);
            }
        }
        
        // Default fallback
        return 0.3; // 300ms
    }

    updateSyncedDelayTime() {
        if (this.syncMode !== 'free') {
            const delayTime = this.calculateSyncedDelayTime(this.syncMode, this.tempo);
            this.delayNode.delayTime.setValueAtTime(delayTime, this.audioContext.currentTime);
            this.updateDelayDisplay(delayTime * 1000);
        }
    }

    updateDelayDisplay(ms) {
        const display = document.querySelector('#delay-time + .value-display');
        if (display) {
            display.textContent = Math.round(ms) + 'ms';
        }
    }

    setDelayFeedback(value) {
        this.delayFeedback.gain.setValueAtTime(Math.min(0.95, value), this.audioContext.currentTime);
    }

    setDelayMix(value) {
        this.delayWetGain.gain.setValueAtTime(value, this.audioContext.currentTime);
    }

    // Improved method to update delay time based on tempo
    updateTempo(bpm) {
        this.tempo = bpm;
        if (this.syncMode !== 'free') {
            this.updateSyncedDelayTime();
        }
    }

    setReverbMix(value) {
        this.reverbWetGain.gain.setValueAtTime(value, this.audioContext.currentTime);
    }

    // Create a basic impulse response for reverb
    generateImpulseResponse() {
        const sampleRate = this.audioContext.sampleRate;
        const length = 2 * sampleRate; // 2 seconds
        const impulseResponse = this.audioContext.createBuffer(2, length, sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulseResponse.getChannelData(channel);
            
            for (let i = 0; i < length; i++) {
                // Exponential decay
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
            }
        }
        
        this.convolver.buffer = impulseResponse;
    }

    calculateSyncedDelayTime(mode, bpm) {
        // Calculate delay time in seconds based on sync mode and tempo
        if (mode === 'free') return this.delayNode.delayTime.value;
        
        const secondsPerBeat = 60 / bpm;  // One quarter note duration
        const secondsPerWholeNote = secondsPerBeat * 4;  // One whole note (4/4 measure)
        
        // Parse the sync mode value
        if (mode.includes('/')) {
            const [numerator, denominator] = mode.split('/').map(n => parseFloat(n));
            
            // Check if it's a standard note value (1/4, 1/8, etc.)
            if (denominator > 0) {
                return secondsPerWholeNote * (numerator / denominator);
            }
        } else if (mode.endsWith('t')) {
            // Handle triplet values (1/4t, 1/8t, etc.)
            const baseValue = mode.slice(0, -1);
            const [numerator, denominator] = baseValue.split('/').map(n => parseFloat(n));
            return (secondsPerWholeNote * (numerator / denominator)) * (2/3);
        }
        
        // Handle specific cases
        switch (mode) {
            // Standard note values
            case '4/1': return secondsPerWholeNote * 4;  // 4 whole notes
            case '2/1': return secondsPerWholeNote * 2;  // 2 whole notes
            case '1/1': return secondsPerWholeNote;      // 1 whole note
            case '1/2': return secondsPerWholeNote / 2;  // Half note
            case '1/4': return secondsPerBeat;           // Quarter note
            case '1/8': return secondsPerBeat / 2;       // Eighth note
            case '1/16': return secondsPerBeat / 4;      // Sixteenth note
            case '1/32': return secondsPerBeat / 8;      // Thirty-second note
            
            // Triplet values (each triplet is 2/3 of its parent note value)
            case '1/3': return secondsPerWholeNote / 3;  // Quarter note triplet (1/3 of a whole note)
            case '1/6': return secondsPerWholeNote / 6;  // Eighth note triplet
            case '1/12': return secondsPerWholeNote / 12; // Sixteenth note triplet
            case '1/24': return secondsPerWholeNote / 24; // Thirty-second note triplet
            
            // Dotted values (each dotted note is 1.5x its base value)
            case '3/4': return secondsPerWholeNote * 0.75; // Dotted half note (3/4 of a whole note)
            case '3/8': return secondsPerWholeNote * 0.375; // Dotted quarter note
            case '3/16': return secondsPerWholeNote * 0.1875; // Dotted eighth note
            case '3/32': return secondsPerWholeNote * 0.09375; // Dotted sixteenth note
            
            // Unusual divisions
            case '1/5': return secondsPerWholeNote / 5;  // Quintuplet quarter note
            case '1/10': return secondsPerWholeNote / 10; // Quintuplet eighth note
            case '1/7': return secondsPerWholeNote / 7;  // Septuplet quarter note
            case '1/14': return secondsPerWholeNote / 14; // Septuplet eighth note
            case '1/9': return secondsPerWholeNote / 9;  // 9-tuplet
            case '1/11': return secondsPerWholeNote / 11; // 11-tuplet
            
            default: return secondsPerBeat;  // Default to quarter note
        }
    }
} 