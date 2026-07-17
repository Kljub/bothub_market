'use strict';

const CHOICES = ['rock', 'paper', 'scissors'];
const EMOJI  = { rock: '🪨', paper: '📄', scissors: '✂️' };
const LABEL  = { rock: 'Stein', paper: 'Papier', scissors: 'Schere' };
const BEATS  = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

function randomChoice() {
    return CHOICES[Math.floor(Math.random() * CHOICES.length)];
}

/** Gibt 'a', 'b' oder 'tie' zurück, je nachdem wer gewinnt. */
function resolve(a, b) {
    if (a === b) return 'tie';
    return BEATS[a] === b ? 'a' : 'b';
}

module.exports = { CHOICES, EMOJI, LABEL, randomChoice, resolve };
