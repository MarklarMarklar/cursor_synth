class Arpeggiator {
    constructor(synth) {
        this.synth = synth;
        this.isPlaying = false;
        this.heldNotes = [];
        this.currentStep = 0;
        this.intervalId = null;
        
        // Arpeggiator settings
        this.settings = {
            rate: 200,        // milliseconds between notes
            octaveSpan: 1,    // how many octaves to span
            mode: 'up',       // up, down, upDown, random
            gateTime: 0.8,    // note duration as percentage of rate
            freeze: false      // Add freeze setting
        };
        
        this.frozenNotes = [];  // Store frozen pattern
    }

    addNote(note, octave) {
        console.log('Adding note:', note, octave);
        const noteInfo = { note, octave, timestamp: Date.now() };  // Add timestamp to maintain sequence
        
        if (!this.settings.freeze) {
            if (!this.heldNotes.some(n => n.note === note && n.octave === octave)) {
                this.heldNotes.push(noteInfo);
                // Sort notes by timestamp to maintain sequence
                this.heldNotes.sort((a, b) => a.timestamp - b.timestamp);
                console.log('Current held notes:', this.heldNotes);
            }
        }
    }

    removeNote(note, octave) {
        if (!this.settings.freeze) {
            console.log('Removing note:', note, octave);
            this.heldNotes = this.heldNotes.filter(n => !(n.note === note && n.octave === octave));
            console.log('Remaining held notes:', this.heldNotes);
        }
    }

    start() {
        console.log('Starting arpeggiator');
        this.isPlaying = true;
        this.currentStep = 0;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        
        // Start the interval
        this.intervalId = setInterval(() => {
            if (this.heldNotes.length > 0) {
                this.playStep();
            }
        }, this.settings.rate);
    }

    stop() {
        console.log('Stopping arpeggiator');
        this.isPlaying = false;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        // Stop all currently playing arpeggiator notes
        const activeNotes = [...this.synth.activeOscillators.entries()]
            .filter(([noteId]) => noteId.startsWith('arp-'));
            
        for (const [noteId, oscillator] of activeNotes) {
            const gainNode = this.synth.activeGains.get(noteId);
            if (gainNode) {
                this.synth.applyADSR(gainNode, false);
                setTimeout(() => {
                    oscillator.stop();
                    oscillator.disconnect();
                    gainNode.disconnect();
                    this.synth.activeOscillators.delete(noteId);
                    this.synth.activeGains.delete(noteId);
                }, this.synth.settings.adsr.release * 1000);
            }
        }
    }

    playStep() {
        if (!this.isPlaying || this.heldNotes.length === 0) return;

        // Get the next note to play
        const notesToPlay = this.getArpNotes();
        let noteIndex;

        switch (this.settings.mode) {
            case 'up':
                noteIndex = this.currentStep % notesToPlay.length;
                break;
            case 'down':
                noteIndex = (notesToPlay.length - 1) - (this.currentStep % notesToPlay.length);
                break;
            case 'upDown':
                const totalSteps = (notesToPlay.length * 2) - 2;
                const step = this.currentStep % totalSteps;
                noteIndex = step < notesToPlay.length ? step : totalSteps - step;
                break;
            case 'random':
                noteIndex = Math.floor(Math.random() * notesToPlay.length);
                break;
        }

        const noteInfo = notesToPlay[noteIndex];
        const noteId = `arp-${noteInfo.note}-${noteInfo.octave}-${this.currentStep}`;

        // Stop previous notes with a small overlap to prevent clicks
        const activeNotes = [...this.synth.activeOscillators.entries()]
            .filter(([noteId]) => noteId.startsWith('arp-'));
            
        for (const [noteId, oscillator] of activeNotes) {
            const gainNode = this.synth.activeGains.get(noteId);
            if (gainNode) {
                // Add a small overlap with the next note
                setTimeout(() => {
                    this.synth.applyADSR(gainNode, false);
                    setTimeout(() => {
                        oscillator.stop();
                        oscillator.disconnect();
                        gainNode.disconnect();
                        this.synth.activeOscillators.delete(noteId);
                        this.synth.activeGains.delete(noteId);
                    }, this.synth.settings.adsr.release * 1000);
                }, 5); // 5ms delay before release
            }
        }

        // Play the new note
        const frequency = this.synth.getNoteFrequency(noteInfo.note, noteInfo.octave);
        const { oscillator, gainNode } = this.synth.createOscillator(frequency);
        
        oscillator.start();
        this.synth.applyADSR(gainNode, true);
        
        this.synth.activeOscillators.set(noteId, oscillator);
        this.synth.activeGains.set(noteId, gainNode);

        // Schedule the note stop
        const gateTimeMs = this.settings.rate * this.settings.gateTime;
        setTimeout(() => {
            if (this.synth.activeOscillators.has(noteId)) {
                this.synth.applyADSR(gainNode, false);
                setTimeout(() => {
                    oscillator.stop();
                    oscillator.disconnect();
                    gainNode.disconnect();
                    this.synth.activeOscillators.delete(noteId);
                    this.synth.activeGains.delete(noteId);
                }, this.synth.settings.adsr.release * 1000);
            }
        }, Math.max(gateTimeMs - 5, 0)); // Ensure gate time doesn't go negative

        this.currentStep++;
    }

    getArpNotes() {
        // Use frozen notes if freeze is enabled, otherwise use held notes
        let notes = this.settings.freeze ? this.frozenNotes : this.heldNotes;
        
        if (this.settings.octaveSpan > 1) {
            const baseNotes = [...notes];
            notes = [];
            
            // Maintain sequence across octaves
            for (let i = 0; i < this.settings.octaveSpan; i++) {
                notes = notes.concat(
                    baseNotes.map(n => ({
                        ...n,
                        octave: n.octave + i
                    }))
                );
            }
        }
        
        return notes;
    }

    setRate(rate) {
        this.settings.rate = rate;
        if (this.isPlaying) {
            this.stop();
            this.start();
        }
    }

    setMode(mode) {
        if (['up', 'down', 'upDown', 'random'].includes(mode)) {
            this.settings.mode = mode;
        }
    }

    setOctaveSpan(span) {
        this.settings.octaveSpan = Math.max(1, Math.min(4, span));
    }

    setGateTime(time) {
        this.settings.gateTime = Math.max(0.1, Math.min(1, time));
    }

    setFreeze(enabled) {
        this.settings.freeze = enabled;
        if (enabled) {
            // Store current pattern
            this.frozenNotes = [...this.heldNotes];
        } else {
            // Clear frozen pattern and reset
            this.frozenNotes = [];
            this.heldNotes = [];
            this.currentStep = 0;
        }
    }
} 