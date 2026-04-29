// src/perception/peak_hour.js

// Checks whether the given time is within Istanbul peak traffic hours
export function isPeakHour(date = new Date()) {
  const hour = date.getHours();
  const minute = date.getMinutes();

  const currentMinutes = hour * 60 + minute;

  const morningStart = 7 * 60 + 30;   // 07:30
  const morningEnd = 9 * 60 + 30;     // 09:30

  const eveningStart = 17 * 60;       // 17:00
  const eveningEnd = 20 * 60;         // 20:00

  return (
    (currentMinutes >= morningStart && currentMinutes <= morningEnd) ||
    (currentMinutes >= eveningStart && currentMinutes <= eveningEnd)
  );
}
