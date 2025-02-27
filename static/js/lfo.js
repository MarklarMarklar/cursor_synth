class LFO {
    constructor(audioContext, settings = {}) {
        this.audioContext = audioContext;
        this.settings = {
            waveform: settings.waveform || 'sine',
            frequency: settings.frequency || 1, // 1 Hz default
            depth: settings.depth || 0.5,
            destination: settings.destination || 'none',
            enabled: false,  // Start disabled by default
            sync: 'free',  // Default to free running
            tempo: 120,     // Default tempo in BPM
            rate: 1,         // Hz
            baseRate: 1      // Store the base rate for modulation purposes
        };

        // Create the oscillator
        this.oscillator = this.audioContext.createOscillator();
        this.depthGain = this.audioContext.createGain();
        
        // Configure oscillator
        this.oscillator.type = this.settings.waveform;
        this.oscillator.frequency.value = this.settings.frequency;
        
        // Configure depth
        this.depthGain.gain.value = 0; // Start with no effect
        
        // Connect nodes
        this.oscillator.connect(this.depthGain);
        
        // Start the oscillator (it will run continuously)
        this.oscillator.start();

        this.destination = null;
        this.baseValue = null;
    }

    connect(parameter, baseValue) {
        if (this.depthGain) {
            this.depthGain.disconnect();
        }

        this.destination = parameter;
        this.baseValue = baseValue;
        this.depthGain.connect(parameter);
    }

    enable() {
        if (!this.destination && this.settings.destination !== 'lfo1-rate' && this.settings.destination !== 'oscillator') {
            console.log("Can't enable LFO - no valid destination");
            return false;
        }
        
        this.settings.enabled = true;
        
        // Special case for LFO2 modulating LFO1's rate
        if (this.settings.destination === 'lfo1-rate') {
            console.log("Enabling LFO for LFO1 rate modulation");
            
            // Make sure LFO1's base rate is properly set
            if (window.synth && window.synth.lfo1) {
                const currentFreq = window.synth.lfo1.oscillator.frequency.value;
                window.synth.lfo1.settings.baseRate = currentFreq;
                console.log("Stored LFO1 base rate:", currentFreq);
            }
            
            return true; // Actual modulation handled in update loop
        }
        
        // Special case for oscillator (pitch) modulation
        if (this.settings.destination === 'oscillator') {
            console.log("Enabling LFO for oscillator pitch modulation");
            return true; // Handled in synth.js update loop
        }
        
        const range = this.getParameterRange();
        const value = this.settings.depth * range;
        
        // Use exponential ramping for smoother transitions
        const now = this.audioContext.currentTime;
        this.depthGain.gain.cancelScheduledValues(now);
        this.depthGain.gain.setValueAtTime(0.001, now); // Start from non-zero value for exponential
        this.depthGain.gain.exponentialRampToValueAtTime(Math.max(0.001, value), now + 0.05);
        
        return true;
    }

    disable() {
        console.log("Disabling LFO", this.settings);
        this.settings.enabled = false;
        
        if (this.depthGain) {
            const now = this.audioContext.currentTime;
            this.depthGain.gain.cancelScheduledValues(now);
            this.depthGain.gain.setValueAtTime(this.depthGain.gain.value, now);
            this.depthGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            // Set to exactly zero after ramp completes
            this.depthGain.gain.setValueAtTime(0, now + 0.06);
        }
    }

    setWaveform(waveform) {
        if (['sine', 'square', 'triangle', 'sawtooth'].includes(waveform)) {
            this.settings.waveform = waveform;
            this.oscillator.type = waveform;
        }
    }

    setFrequency(frequency) {
        // Only update if not tempo-synced
        if (this.settings.sync === 'free') {
            // Limit to reasonable range
            this.settings.frequency = Math.max(0.1, Math.min(20, frequency));
            
            // Store base rate for modulation reference
            this.settings.baseRate = this.settings.frequency;
            
            // If this is LFO1 and it's being modulated by LFO2, don't directly set the oscillator
            // frequency as that would override the modulation
            if (window.synth && 
                window.synth.lfo2 && 
                window.synth.lfo2.settings.enabled && 
                window.synth.lfo2.settings.destination === 'lfo1-rate' &&
                this === window.synth.lfo1) {
                
                console.log("LFO1 base rate updated to", this.settings.baseRate);
            } else {
                // Otherwise, set the oscillator frequency normally
                this.oscillator.frequency.setValueAtTime(
                    this.settings.frequency,
                    this.audioContext.currentTime
                );
            }
        }
    }

    setDepth(depth) {
        depth = Math.max(0, Math.min(1, depth)); // Clamp to 0-1 range
        this.settings.depth = depth;
        
        // If not enabled, just store the value
        if (!this.settings.enabled) return;
        
        // For LFO1 rate modulation, depth changes take effect immediately in the update cycle
        if (this.settings.destination === 'lfo1-rate') {
            console.log(`LFO depth set to ${depth} for LFO1 rate modulation`);
            return;
        }
        
        // For other destinations, apply gain change
        if (this.depthGain && this.destination) {
            const range = this.getParameterRange();
            const value = depth * range;
            
            // Use a small ramp for smoother transitions
            const now = this.audioContext.currentTime;
            this.depthGain.gain.cancelScheduledValues(now);
            this.depthGain.gain.setValueAtTime(this.depthGain.gain.value, now);
            this.depthGain.gain.linearRampToValueAtTime(value, now + 0.05);
        }
    }

    setDestination(destination) {
        this.settings.destination = destination;
        
        // Reset modulation
        if (this.depthGain) {
            this.depthGain.disconnect();
            this.depthGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        }

        this.destination = null;
        this.baseValue = null;
    }

    toggle() {
        if (this.settings.enabled) {
            this.disable();
            return false;
        } else {
            const result = this.enable();
            return result;
        }
    }

    // Helper method to determine appropriate modulation range for a parameter
    getParameterRange() {
        switch (this.settings.destination) {
            case 'filter':
                return 5000; // Filter frequency range
            case 'amplitude':
                return 0.5;  // Amplitude range
            case 'oscillator':
                return 50;   // Detune range (cents)
            default:
                return 1;    // Default range
        }
    }

    // Add method for tempo sync
    setSync(syncMode) {
        this.settings.sync = syncMode;
        
        // If not free, calculate frequency based on tempo
        if (syncMode !== 'free') {
            this.updateFrequencyFromTempo();
        }
    }

    // Calculate frequency from tempo and time division
    updateFrequencyFromTempo() {
        if (this.settings.sync === 'free') return;
        
        const bpm = this.settings.tempo;
        let frequency;
        
        if (this.settings.sync.endsWith('t')) {
            // Triplet timing
            const [numerator, denominator] = this.settings.sync.slice(0, -1).split('/').map(Number);
            frequency = (bpm * denominator) / (numerator * 60 * 3);
        } else {
            // Regular timing
            const [numerator, denominator] = this.settings.sync.split('/').map(Number);
            frequency = (bpm * denominator) / (numerator * 60);
        }
        
        // Limit maximum frequency to prevent audio artifacts
        frequency = Math.min(frequency, 20);
        
        // Use smoother transition for frequency changes
        const now = this.audioContext.currentTime;
        this.oscillator.frequency.cancelScheduledValues(now);
        this.oscillator.frequency.setValueAtTime(this.oscillator.frequency.value, now);
        this.oscillator.frequency.linearRampToValueAtTime(frequency, now + 0.05);
        
        // Store the calculated frequency
        this.settings.frequency = frequency;
        this.settings.baseRate = frequency; // Store the base rate
        
        // Update slider display if available
        this.updateRateDisplay();
    }

    updateRateDisplay() {
        // Try to find the slider for this LFO
        let index;
        if (this === window.synth.lfo1) index = 0;
        else if (this === window.synth.lfo2) index = 1;
        else return;
        
        const slider = document.querySelector(`#lfo${index + 1}-sync`).nextElementSibling;
        const display = slider?.nextElementSibling;
        
        if (slider && display) {
            slider.value = this.settings.frequency;
            display.textContent = 
                this.settings.sync !== 'free' 
                    ? `${this.settings.sync} (${this.settings.frequency.toFixed(2)} Hz)` 
                    : `${this.settings.frequency} Hz`;
        }
    }

    // Add method to update tempo
    updateTempo(tempo) {
        this.settings.tempo = tempo;
        if (this.settings.sync !== 'free') {
            this.updateFrequencyFromTempo();
        }
    }

    // Get current modulation value based on oscillator phase
    getModulationValue() {
        // Calculate a modulation value between -1 and 1 based on the oscillator phase
        const time = this.audioContext.currentTime;
        const frequency = this.settings.frequency;
        const phase = (time * frequency) % 1; // Normalized phase (0-1)
        
        switch(this.settings.waveform) {
            case 'sine':
                return Math.sin(phase * 2 * Math.PI);
            case 'triangle':
                return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
            case 'square':
                return phase < 0.5 ? 1 : -1;
            case 'sawtooth':
                return 2 * phase - 1;
            default:
                return 0;
        }
    }
    
    // Update method called on each animation frame
    update() {
        // Only run if enabled
        if (!this.settings.enabled) return;
        
        // Special case for LFO2 modulating LFO1 rate
        if (this.settings.destination === 'lfo1-rate' && window.synth && window.synth.lfo1) {
            this.modulateLfo1Rate();
        }
    }
    
    // Method to modulate LFO1's rate from LFO2
    modulateLfo1Rate() {
        if (!window.synth || !window.synth.lfo1 || !window.synth.lfo1.oscillator) return;
        
        try {
            // Get modulation value (-1 to 1)
            const modValue = this.getModulationValue();
            
            // Get LFO1's base rate - we need to reference this correctly
            // If baseRate is not set up, use the current frequency setting
            const baseRate = window.synth.lfo1.settings.baseRate;
            
            // Calculate a modulation factor that ranges from 0.25 to 4.0 
            // based on depth setting (providing 2 octaves of range at full depth)
            const modRange = this.settings.depth * 2; // Full depth gives 2 octaves range
            const modFactor = Math.pow(2, modValue * modRange);
            
            // Calculate the new rate as a multiplication of base rate and modulation factor
            const newRate = baseRate * modFactor;
            
            // Limit to a reasonable range to prevent extreme values
            const limitedRate = Math.max(0.1, Math.min(30, newRate));
            
            // Apply the new rate to LFO1 with a slight ramp for smoothness
            const now = this.audioContext.currentTime;
            window.synth.lfo1.oscillator.frequency.cancelScheduledValues(now);
            window.synth.lfo1.oscillator.frequency.setValueAtTime(
                window.synth.lfo1.oscillator.frequency.value, 
                now
            );
            window.synth.lfo1.oscillator.frequency.exponentialRampToValueAtTime(
                Math.max(0.1, limitedRate), // Ensure we don't go to zero for exponential ramp
                now + 0.01 // Very short ramp for responsive modulation but avoid clicks
            );
            
            // Debug output
            if (Math.random() < 0.01) { // Only log occasionally to avoid flooding console
                console.log(`LFO Modulation: Base=${baseRate.toFixed(2)}Hz, Mod=${modValue.toFixed(2)}, Factor=${modFactor.toFixed(2)}, New=${limitedRate.toFixed(2)}Hz`);
            }
            
        } catch (err) {
            console.error("Error in LFO modulation:", err);
        }
    }
} 