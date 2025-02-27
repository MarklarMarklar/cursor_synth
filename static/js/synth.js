class WebSynth {
    constructor() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser", e);
            alert("Web Audio API is not supported in this browser. Please try Chrome or Firefox.");
            return;
        }
        
        // Initialize Web Audio API
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);
        
        // Synth settings
        this.settings = {
            waveform: 'sine',
            octave: 4,
            amplitude: 0.5,
            polyphony: 16, // Add polyphony limit
            adsr: {
                attack: 0.1,
                decay: 0.1,
                sustain: 0.7,
                release: 0.2
            },
            filter: {
                type: 'lowpass',
                frequency: 20000,
                resonance: 0
            }
        };

        // Note frequencies for middle octave (4)
        this.baseFrequencies = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
            'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
        };

        // Keep track of active notes
        this.activeOscillators = new Map();
        this.activeGains = new Map();
        this.noteReleaseTimeouts = new Map(); // Track note release timeouts
        
        // Add voice stack to manage polyphony
        this.voiceStack = [];

        // Keyboard mapping
        this.keyboardMap = {
            'a': 'C', 'w': 'C#', 's': 'D', 'e': 'D#', 'd': 'E',
            'f': 'F', 't': 'F#', 'g': 'G', 'y': 'G#', 'h': 'A',
            'u': 'A#', 'j': 'B', 'k': 'C'
        };

        // Add keyboard notes configuration
        this.keyboardNotes = [
            { note: 'C', type: 'white' },
            { note: 'C#', type: 'black' },
            { note: 'D', type: 'white' },
            { note: 'D#', type: 'black' },
            { note: 'E', type: 'white' },
            { note: 'F', type: 'white' },
            { note: 'F#', type: 'black' },
            { note: 'G', type: 'white' },
            { note: 'G#', type: 'black' },
            { note: 'A', type: 'white' },
            { note: 'A#', type: 'black' },
            { note: 'B', type: 'white' }
        ];

        // Create a simpler filter implementation
        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 20000;
        this.filter.Q.value = 0;

        // Create a proper audio chain
        this.masterGain.disconnect();
        this.masterGain.connect(this.filter);
        
        // Initialize effects with the filter as input
        this.effects = new AudioEffects(this.audioContext);
        this.effects.connectInput(this.filter);
        this.effects.connectOutput(this.audioContext.destination);

        // Add filter settings to synth settings
        this.settings.filter = {
            type: 'lowpass',
            frequency: 20000,
            resonance: 0,
            mix: 1
        };

        // Initialize arpeggiator
        this.arpeggiator = new Arpeggiator(this);

        // Initialize LFOs correctly
        this.lfo1 = new LFO(this.audioContext);
        this.lfo2 = new LFO(this.audioContext);

        // Initialize settings for both LFOs
        this.settings.lfo = [
            { waveform: 'sine', frequency: 1, depth: 0.5, destination: 'none', enabled: false },
            { waveform: 'sine', frequency: 1, depth: 0.5, destination: 'none', enabled: false }
        ];

        // Initialize sequencer (and enable it by default)
        this.sequencer = new Sequencer(this);

        // Track LFOs that are modulating oscillators
        this.activeLFOs = new Set();

        this.setupEventListeners();
        this.createKeyboard();

        // Start animation frame for continuous updates - ONLY ONE LOOP NOW
        this.startUpdateLoop();
    }

    setupEventListeners() {
        // Computer keyboard events
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }

    getNoteFrequency(note, octave = this.settings.octave) {
        const baseFreq = this.baseFrequencies[note];
        const octaveDiff = octave - 4;
        return baseFreq * Math.pow(2, octaveDiff);
    }

    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.type = this.settings.waveform;
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        
        // Connect nodes through filter
        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);
        
        return { oscillator, gainNode };
    }

    applyADSR(gainNode, isNoteOn, velocity = 1) {
        const { attack, decay, sustain, release } = this.settings.adsr;
        const now = this.audioContext.currentTime;
        const fadeTime = 0.002;

        if (isNoteOn) {
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(0.001, now + fadeTime);
            gainNode.gain.linearRampToValueAtTime(this.settings.amplitude * velocity, now + fadeTime + attack);
            gainNode.gain.linearRampToValueAtTime(
                this.settings.amplitude * sustain * velocity, 
                now + fadeTime + attack + decay
            );
        } else {
            const currentValue = gainNode.gain.value;
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(currentValue, now);
            // Add release with tiny fade at the end
            gainNode.gain.linearRampToValueAtTime(currentValue * 0.1, now + release - fadeTime);
            gainNode.gain.linearRampToValueAtTime(0, now + release);
        }
    }

    createKeyboard() {
        const keyboard = document.getElementById('keyboard');
        const octaves = 3; // 3 octaves visible at a time
        keyboard.innerHTML = ''; // Clear existing keyboard

        // Create containers - now they're just wrappers
        const whiteKeysContainer = document.createElement('div');
        whiteKeysContainer.className = 'white-keys';
        keyboard.appendChild(whiteKeysContainer);

        const blackKeysContainer = document.createElement('div');
        blackKeysContainer.className = 'black-keys';
        keyboard.appendChild(blackKeysContainer);

        // Create keys for each octave with absolute positioning
        for (let octave = 0; octave < octaves; octave++) {
            const currentOctave = this.settings.octave + octave;
            
            // Create all keys and position them using CSS classes
            this.keyboardNotes.forEach(({ note, type }) => {
                const key = this.createKey(note, type, currentOctave);
                
                // Add to appropriate container
                if (type === 'white') {
                    whiteKeysContainer.appendChild(key);
                } else {
                    blackKeysContainer.appendChild(key);
                }
            });
        }
    }

    createKey(note, type, octave) {
        const key = document.createElement('div');
        key.className = `key ${type}-key`;
        key.dataset.note = note;
        key.dataset.octave = octave;

        // Add event listeners
        const startNoteHandler = (e) => {
            e.preventDefault();
            this.startNote(note, octave);
            key.classList.add('active');
        };

        const stopNoteHandler = (e) => {
            e.preventDefault();
            this.stopNote(note, octave);
            key.classList.remove('active');
        };

        key.addEventListener('mousedown', startNoteHandler);
        key.addEventListener('mouseup', stopNoteHandler);
        key.addEventListener('mouseleave', stopNoteHandler);
        key.addEventListener('touchstart', startNoteHandler);
        key.addEventListener('touchend', stopNoteHandler);

        return key;
    }

    startNote(note, octave) {
        // Only start if audio context is running
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        const noteId = `${note}-${octave}`;
        
        // Already playing this note
        if (this.activeOscillators.has(noteId)) {
            // Cancel any pending release
            if (this.noteReleaseTimeouts.has(noteId)) {
                clearTimeout(this.noteReleaseTimeouts.get(noteId));
                this.noteReleaseTimeouts.delete(noteId);
                
                // If the note was being released, restore it to full volume
                const gainNode = this.activeGains.get(noteId);
                const now = this.audioContext.currentTime;
                gainNode.gain.cancelScheduledValues(now);
                gainNode.gain.setValueAtTime(gainNode.gain.value, now);
                gainNode.gain.linearRampToValueAtTime(this.settings.amplitude, now + this.settings.adsr.attack);
            }
            
            // Remove from voice stack (if present) and add back at the end
            this.voiceStack = this.voiceStack.filter(id => id !== noteId);
            this.voiceStack.push(noteId);
            
            return;
        }
        
        // Manage polyphony - will free oldest voice if we've hit the limit
        this.managePolyphony();
        
        // Create new oscillator
        const frequency = this.getNoteFrequency(note, octave);
        const { oscillator, gainNode } = this.createOscillator(frequency);
        
        // Store note information for pitch modulation
        oscillator.note = note;
        oscillator.octave = octave;
        
        oscillator.start();
        
        // Apply ADSR envelope
        const now = this.audioContext.currentTime;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(this.settings.amplitude, now + this.settings.adsr.attack);
        
        this.activeOscillators.set(noteId, oscillator);
        this.activeGains.set(noteId, gainNode);
        
        // Add to voice stack (most recent at the end)
        this.voiceStack.push(noteId);
    }
    
    stopNote(note, octave) {
        const noteId = `${note}-${octave}`;
        
        if (this.activeOscillators.has(noteId)) {
            // Cancel any pending release
            if (this.noteReleaseTimeouts.has(noteId)) {
                clearTimeout(this.noteReleaseTimeouts.get(noteId));
                this.noteReleaseTimeouts.delete(noteId);
            }
            
            const now = this.audioContext.currentTime;
            const gainNode = this.activeGains.get(noteId);
            const releaseTime = this.settings.adsr.release;
            
            // Apply release phase
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(gainNode.gain.value, now); // Start from current value
            gainNode.gain.linearRampToValueAtTime(0, now + releaseTime);
            
            // Schedule disconnection after release time
            const disconnectTimeout = setTimeout(() => {
                if (this.activeOscillators.has(noteId)) {
                    const osc = this.activeOscillators.get(noteId);
                    osc.stop();
                    osc.disconnect();
                    this.activeOscillators.delete(noteId);
                }
                
                if (this.activeGains.has(noteId)) {
                    this.activeGains.get(noteId).disconnect();
                    this.activeGains.delete(noteId);
                }
                
                // Remove from voice stack if still present
                this.voiceStack = this.voiceStack.filter(id => id !== noteId);
                
                // Remove from release timeouts
                this.noteReleaseTimeouts.delete(noteId);
            }, releaseTime * 1000 + 50); // Add 50ms buffer to be safe
            
            this.noteReleaseTimeouts.set(noteId, disconnectTimeout);
        }
    }

    handleKeyDown(event) {
        if (event.repeat) return;
        const note = this.keyboardMap[event.key.toLowerCase()];
        if (note) {
            this.startNote(note);
        }
    }

    handleKeyUp(event) {
        const note = this.keyboardMap[event.key.toLowerCase()];
        if (note) {
            this.stopNote(note);
        }
    }

    setWaveform(type) {
        if (['sine', 'square', 'triangle', 'sawtooth'].includes(type)) {
            this.settings.waveform = type;
        }
    }

    setOctave(octave) {
        if (octave >= 0 && octave <= 8) {
            this.settings.octave = octave;
            document.getElementById('octave-display').textContent = octave;
            this.createKeyboard(); // Recreate keyboard with new octave
        }
    }

    setADSR(attack, decay, sustain, release) {
        this.settings.adsr = { attack, decay, sustain, release };
    }

    setAmplitude(value) {
        this.settings.amplitude = Math.max(0, Math.min(1, value));
        this.masterGain.gain.setValueAtTime(
            this.settings.amplitude, 
            this.audioContext.currentTime
        );
    }

    // Add ADSR update method
    updateADSR() {
        const sliders = document.querySelectorAll('.adsr-slider');
        const [attack, decay, sustain, release] = Array.from(sliders).map(slider => parseFloat(slider.value));
        this.setADSR(attack, decay, sustain, release);
    }

    // Add these methods to control effects
    setDelayTime(value) {
        this.effects.setDelayTime(parseFloat(value));
    }

    setDelayFeedback(value) {
        this.effects.setDelayFeedback(parseFloat(value));
    }

    setDelayMix(value) {
        this.effects.setDelayMix(parseFloat(value));
    }

    setReverbMix(value) {
        this.effects.setReverbMix(parseFloat(value));
    }

    // Add these methods to control the arpeggiator
    toggleArpeggiator() {
        const button = document.getElementById('arp-toggle');
        if (!this.arpeggiator) return;

        if (this.arpeggiator.isPlaying) {
            this.arpeggiator.stop();
            button.classList.remove('active');
            button.textContent = 'Enable Arpeggiator';
        } else {
            this.arpeggiator.start();
            button.classList.add('active');
            button.textContent = 'Disable Arpeggiator';
        }
    }

    setArpRate(value) {
        this.arpeggiator.setRate(parseInt(value));
        document.querySelector('.arp-controls .value-display').textContent = value + 'ms';
    }

    setArpMode(mode) {
        this.arpeggiator.setMode(mode);
    }

    setArpOctaveSpan(value) {
        this.arpeggiator.setOctaveSpan(parseInt(value));
        document.querySelectorAll('.arp-controls .value-display')[1].textContent = value;
    }

    setArpGateTime(value) {
        this.arpeggiator.setGateTime(parseFloat(value));
        document.querySelectorAll('.arp-controls .value-display')[2].textContent = value;
    }

    toggleArpFreeze() {
        const button = document.getElementById('arp-freeze');
        if (!this.arpeggiator) return;

        const isFreeze = !this.arpeggiator.settings.freeze;
        this.arpeggiator.setFreeze(isFreeze);

        if (isFreeze) {
            button.classList.add('active');
            button.textContent = 'Unfreeze Pattern';
        } else {
            button.classList.remove('active');
            button.textContent = 'Freeze Pattern';
        }
    }

    // Update filter control methods
    setFilterType(type) {
        if (['lowpass', 'highpass', 'bandpass', 'notch'].includes(type)) {
            this.filter.type = type;
            this.settings.filter.type = type;
            console.log("Filter type set to:", type);
        }
    }

    setFilterCutoff(frequency) {
        // Simple logarithmic mapping
        const value = parseInt(frequency);
        const minValue = 20;
        const maxValue = 20000;
        
        // Map slider value (20-20000) to logarithmic frequency scale
        const logMin = Math.log(minValue);
        const logMax = Math.log(maxValue);
        const scale = (logMax - logMin) / (maxValue - minValue);
        
        // Calculate frequency with logarithmic scale
        const logFreq = Math.exp(logMin + scale * (value - minValue));
        
        console.log("Setting filter cutoff to:", logFreq);
        this.filter.frequency.value = logFreq;
        this.settings.filter.frequency = logFreq;
    }

    setFilterResonance(resonance) {
        const value = parseFloat(resonance);
        console.log("Setting filter resonance to:", value);
        this.filter.Q.value = value;
        this.settings.filter.resonance = value;
    }

    setFilterMix(mix) {
        // No mix parameter in this simpler implementation
        // This is mainly kept for backward compatibility
        this.settings.filter.mix = parseFloat(mix);
    }

    // LFO control methods
    setLfoWaveform(lfoIndex, waveform) {
        if (lfoIndex === 0 && this.lfo1) {
            this.lfo1.setWaveform(waveform);
        } else if (lfoIndex === 1 && this.lfo2) {
            this.lfo2.setWaveform(waveform);
        }
    }

    setLfoRate(lfoIndex, rate) {
        const parsedRate = parseFloat(rate);
        if (lfoIndex === 0 && this.lfo1) {
            this.lfo1.setFrequency(parsedRate);
            
            // Update display
            const display = document.querySelector('.lfo-params:nth-child(1) .value-display');
            if (display) {
                display.textContent = parsedRate + ' Hz';
            }
        } else if (lfoIndex === 1 && this.lfo2) {
            this.lfo2.setFrequency(parsedRate);
            
            // Update display
            const display = document.querySelector('.lfo-params:nth-child(2) .value-display');
            if (display) {
                display.textContent = parsedRate + ' Hz';
            }
        }
    }

    setLfoDepth(lfoIndex, depth) {
        const parsedDepth = parseFloat(depth);
        if (lfoIndex === 0 && this.lfo1) {
            this.lfo1.setDepth(parsedDepth);
            
            // Update percentage display
            const display = document.querySelectorAll('.lfo-params')[0].querySelectorAll('.value-display')[1];
            if (display) {
                display.textContent = Math.round(parsedDepth * 100) + '%';
            }
        } else if (lfoIndex === 1 && this.lfo2) {
            this.lfo2.setDepth(parsedDepth);
            
            // Update percentage display
            const display = document.querySelectorAll('.lfo-params')[1].querySelectorAll('.value-display')[1];
            if (display) {
                display.textContent = Math.round(parsedDepth * 100) + '%';
            }
        }
    }

    setLfoDestination(lfoIndex, destination) {
        console.log(`Setting LFO ${lfoIndex} destination to ${destination}`);
        
        if (lfoIndex === 0 && this.lfo1) {
            this.lfo1.setDestination(destination);
            
            // Connect LFO1 to the appropriate parameter
            if (destination === 'filter') {
                this.lfo1.connect(this.filter.frequency, this.filter.frequency.value);
            } else if (destination === 'amplitude') {
                this.lfo1.connect(this.masterGain.gain, this.settings.amplitude);
            }
            
        } else if (lfoIndex === 1 && this.lfo2) {
            // If we're changing from lfo1-rate to something else, restore LFO1's base frequency
            if (this.lfo2.settings.destination === 'lfo1-rate' && destination !== 'lfo1-rate' && this.lfo1) {
                const baseRate = this.lfo1.settings.baseRate || 1;
                this.lfo1.oscillator.frequency.setValueAtTime(
                    baseRate, 
                    this.audioContext.currentTime
                );
                console.log("LFO1 rate restored to base value:", baseRate);
            }
            
            this.lfo2.setDestination(destination);
            
            // Connect LFO2 to the appropriate parameter
            if (destination === 'filter') {
                this.lfo2.connect(this.filter.frequency, this.filter.frequency.value);
            } else if (destination === 'amplitude') {
                this.lfo2.connect(this.masterGain.gain, this.settings.amplitude);
            } else if (destination === 'lfo1-rate' && this.lfo1) {
                // Store LFO1's current frequency as baseRate for modulation reference
                const currentFreq = this.lfo1.oscillator.frequency.value;
                this.lfo1.settings.baseRate = currentFreq;
                console.log("Set LFO1 base rate for modulation:", currentFreq);
            }
        }
    }

    // Updated sequencer methods to match simplified controls
    toggleSequencer() {
        console.log('Toggle sequencer', this.sequencer.isPlaying);
        
        // Always ensure audio context is running
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        if (this.sequencer.isPlaying) {
            this.sequencer.stop();
        } else {
            this.sequencer.start();
        }
    }

    setSequencerTempo(tempo) {
        const bpm = parseInt(tempo);
        this.sequencer.setTempo(bpm);
        this.effects.updateTempo(bpm);
        
        // Update LFO tempos
        this.lfo1.updateTempo(bpm);
        this.lfo2.updateTempo(bpm);
    }

    setSequencerDivision(division) {
        this.sequencer.setDivision(parseInt(division));
    }

    setSequencerGate(length) {
        this.sequencer.setGateLength(length);
    }

    resetAudio() {
        console.log("Resetting audio engine completely");
        
        // Stop all current sounds
        this.cleanupAllNotes();
        
        // Stop sequencer if running
        if (this.sequencer && this.sequencer.isPlaying) {
            this.sequencer.stop();
        }
        
        // Stop arpeggiator if running
        if (this.arpeggiator && this.arpeggiator.isPlaying) {
            this.arpeggiator.stop();
        }
        
        try {
            // Create new audio context
            const oldContext = this.audioContext;
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Recreate audio chain
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.settings.amplitude;
            
            this.filter = this.audioContext.createBiquadFilter();
            this.filter.type = this.settings.filter.type;
            this.filter.frequency.value = this.settings.filter.frequency;
            this.filter.Q.value = this.settings.filter.resonance;
            
            // Recreate effects
            this.effects = new AudioEffects(this.audioContext);
            
            // Reconnect everything
            this.masterGain.connect(this.filter);
            this.effects.connectInput(this.filter);
            this.effects.connectOutput(this.audioContext.destination);
            
            // Recreate LFOs
            this.lfo1 = new LFO(this.audioContext);
            this.lfo2 = new LFO(this.audioContext);
            
            // Reinitialize sequencer and arpeggiator
            this.sequencer = new Sequencer(this);
            this.arpeggiator = new Arpeggiator(this);
            
            // Re-create the keyboard
            this.createKeyboard();
            
            // Close old context after a brief delay
            setTimeout(() => {
                oldContext.close().catch(err => console.error("Error closing old context:", err));
            }, 100);
            
            console.log("Audio engine reset completed");
            
            // Show a user notification
            alert("Audio engine has been reset.");
            
        } catch (error) {
            console.error("Error during audio reset:", error);
            alert("Error resetting audio engine. Please reload the page.");
        }
    }

    setSequencerLength(length) {
        this.sequencer.setLength(parseInt(length));
    }

    setDelaySync(syncMode) {
        this.effects.setDelaySync(syncMode);
    }

    toggleLFO(lfoIndex) {
        if (lfoIndex === 0 && this.lfo1) {
            const isEnabled = this.lfo1.toggle();
            const button = document.getElementById('lfo1-toggle');
            if (button) {
                button.textContent = isEnabled ? 'LFO On' : 'LFO Off';
                button.classList.toggle('active', isEnabled);
            }
        } else if (lfoIndex === 1 && this.lfo2) {
            const isEnabled = this.lfo2.toggle();
            const button = document.getElementById('lfo2-toggle');
            if (button) {
                button.textContent = isEnabled ? 'LFO On' : 'LFO Off';
                button.classList.toggle('active', isEnabled);
            }
        }
    }

    setLfoSync(index, syncMode) {
        if (index >= 0 && index < 2) {
            this.lfo1.setSync(syncMode);
            this.settings.lfo[index].sync = syncMode;
            
            // Update UI: enable/disable the rate slider based on sync mode
            const syncSelect = document.getElementById(`lfo${index + 1}-sync`);
            const rateSlider = syncSelect.nextElementSibling;
            
            if (syncMode === 'free') {
                rateSlider.disabled = false;
            } else {
                rateSlider.disabled = true;
            }
        }
    }

    // Add a specific method for sequencer to play notes
    playNote(note, octave, velocity = 1) {
        // Only start if audio context is running
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        const noteId = `${note}-${octave}`;
        
        // Handle case where note is already playing
        if (this.activeOscillators.has(noteId)) {
            // Cancel any pending release
            if (this.noteReleaseTimeouts.has(noteId)) {
                clearTimeout(this.noteReleaseTimeouts.get(noteId));
                this.noteReleaseTimeouts.delete(noteId);
            }
            
            // Don't start a new note, just update its gain
            const gainNode = this.activeGains.get(noteId);
            if (gainNode) {
                const now = this.audioContext.currentTime;
                gainNode.gain.cancelScheduledValues(now);
                gainNode.gain.setValueAtTime(gainNode.gain.value, now);
                gainNode.gain.linearRampToValueAtTime(this.settings.amplitude * velocity, now + 0.01);
            }
            
            // Move to end of voice stack (most recent)
            this.voiceStack = this.voiceStack.filter(id => id !== noteId);
            this.voiceStack.push(noteId);
            
            return;
        }
        
        // Manage polyphony - will free oldest voice if we've hit the limit
        this.managePolyphony();
        
        // Create and play a new note
        const frequency = this.getNoteFrequency(note, octave);
        const { oscillator, gainNode } = this.createOscillator(frequency);
        
        oscillator.start();
        
        // Apply attack immediately, but with a simplified envelope for sequencer notes
        const now = this.audioContext.currentTime;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(this.settings.amplitude * velocity, now + 0.01);
        
        this.activeOscillators.set(noteId, oscillator);
        this.activeGains.set(noteId, gainNode);
        
        // Add to voice stack (most recent at the end)
        this.voiceStack.push(noteId);
    }

    // Manage polyphony by freeing oldest voice if needed
    managePolyphony() {
        // If we haven't reached the polyphony limit, no action needed
        if (this.activeOscillators.size < this.settings.polyphony) {
            return;
        }
        
        // Find the oldest note and release it
        if (this.voiceStack.length > 0) {
            const oldestNoteId = this.voiceStack.shift();
            console.log(`Polyphony limit reached. Releasing oldest note: ${oldestNoteId}`);
            // Force immediate release of the oldest note
            this.forceReleaseNote(oldestNoteId);
        }
    }
    
    // Immediate force release of a note (for polyphony management)
    forceReleaseNote(noteId) {
        if (this.activeOscillators.has(noteId)) {
            // Cancel any pending release
            if (this.noteReleaseTimeouts.has(noteId)) {
                clearTimeout(this.noteReleaseTimeouts.get(noteId));
                this.noteReleaseTimeouts.delete(noteId);
            }
            
            const now = this.audioContext.currentTime;
            const gainNode = this.activeGains.get(noteId);
            
            // Quick fade out to avoid clicks
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(gainNode.gain.value, now);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.03);
            
            // Schedule cleanup
            setTimeout(() => {
                if (this.activeOscillators.has(noteId)) {
                    const osc = this.activeOscillators.get(noteId);
                    osc.stop();
                    osc.disconnect();
                    this.activeOscillators.delete(noteId);
                }
                
                if (this.activeGains.has(noteId)) {
                    this.activeGains.get(noteId).disconnect();
                    this.activeGains.delete(noteId);
                }
            }, 50); // 50ms should be enough for the short fade
        }
    }
    
    // Clean up all notes - useful when switching modes or stopping sequencer
    cleanupAllNotes() {
        const noteIds = Array.from(this.activeOscillators.keys());
        noteIds.forEach(noteId => {
            this.forceReleaseNote(noteId);
        });
        
        // Clear any pending timeouts
        this.noteReleaseTimeouts.forEach(timeout => clearTimeout(timeout));
        this.noteReleaseTimeouts.clear();
        
        // Reset voice stack
        this.voiceStack = [];
    }

    setPolyphony(value) {
        // Set a limit between 4 and 32 voices
        value = Math.max(4, Math.min(32, parseInt(value)));
        this.settings.polyphony = value;
        console.log(`Polyphony limit set to ${value} voices`);
        
        // If we're over the limit, release some notes
        while (this.activeOscillators.size > this.settings.polyphony) {
            this.managePolyphony();
        }
        
        // Update display if available
        const display = document.getElementById('polyphony-display');
        if (display) {
            display.textContent = value;
        }
    }
    
    // Make sure to add the polyphony setup in the initControls method
    initControls() {
        // ... existing control initialization ...
        
        // Polyphony control
        const polyphonyControl = document.getElementById('polyphony-control');
        if (polyphonyControl) {
            polyphonyControl.value = this.settings.polyphony;
            polyphonyControl.addEventListener('input', (e) => {
                this.setPolyphony(e.target.value);
            });
        }
        
        // ... rest of the method ...
    }

    // Combined update loop for all animation frame needs
    startUpdateLoop() {
        const update = () => {
            // LFO updates
            if (this.lfo1) this.lfo1.update();
            if (this.lfo2) this.lfo2.update();
            
            // LFO2->LFO1 rate modulation
            if (this.lfo2 && this.lfo2.settings.enabled && 
                this.lfo2.settings.destination === 'lfo1-rate') {
                this.lfo2.update();
            }
            
            // Handle oscillator pitch modulation
            this.handleOscillatorPitchModulation();
            
            // Request next frame
            requestAnimationFrame(update);
        };
        
        // Start the loop
        update();
    }

    // Method to handle LFO oscillator pitch modulation
    handleOscillatorPitchModulation() {
        // Skip if no oscillators active
        if (this.activeOscillators.size === 0) return;
        
        // Skip if neither LFO is targeting oscillator
        const lfo1Active = this.lfo1 && this.lfo1.settings.enabled && this.lfo1.settings.destination === 'oscillator';
        const lfo2Active = this.lfo2 && this.lfo2.settings.enabled && this.lfo2.settings.destination === 'oscillator';
        
        if (!lfo1Active && !lfo2Active) return;
        
        // Apply modulation to all active oscillators
        for (const [noteId, oscillator] of this.activeOscillators.entries()) {
            // Skip if missing note info
            if (!oscillator || !oscillator.note || !oscillator.octave) continue;
            
            // Calculate modulation from LFO1
            let modulation = 0;
            if (lfo1Active) {
                const modValue = this.lfo1.getModulationValue();
                modulation += modValue * this.lfo1.settings.depth * 50; // +/- 50 cents max
            }
            
            // Add modulation from LFO2
            if (lfo2Active) {
                const modValue = this.lfo2.getModulationValue();
                modulation += modValue * this.lfo2.settings.depth * 50; // +/- 50 cents max
            }
            
            // Set detune amount (in cents)
            oscillator.detune.setValueAtTime(modulation, this.audioContext.currentTime);
        }
    }
}

// Initialize synthesizer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.synth = new WebSynth();
}); 