'use strict';
const KD = require('../lib/kitchen-domain');

let counter = 0;
const id = (p) => `${p}_${counter++}`;

function dish(name, ingredients) {
  return {
    id: id('dish'),
    name,
    ingredients: ingredients.map((i) => ({ id: id('ing'), ...i })),
  };
}

function headcount(patients, staff, overrides = {}) {
  return { basePatients: patients, baseStaff: staff, overrides };
}

/** A week (Sunday 2026-07-12) with the given dishes placed on each day's lunch. */
function weekWithLunch(dishesByDay) {
  const week = KD.emptyWeekMenu('2026-07-12');
  for (const day of Object.keys(dishesByDay)) {
    week.days[day].lunch = dishesByDay[day] || [];
  }
  return week;
}

module.exports = { dish, headcount, weekWithLunch };
