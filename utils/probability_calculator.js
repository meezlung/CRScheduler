export class ProbabilityCalculator {
  constructor() {
    this.CUMULATIVE_PRIO_TO_PERCENTAGE_MAP = {
      "specialneeds": 0.0,
      "graduating": 0.05,
      "assistant": 0.15,
      "freshman": 0.16,
      "varsity": 0.41,
      "cadetofficer": 0.46,
      "regular": 0.47,
      "lowpriority": 0.95,
    }; 
  }

  getPreviousPriority(priority) {
    // Get the list of priorities in order and find the previous priority
    const priorityKey = priority.toLowerCase().replace(/\s+/g, "");
    const priorities = Object.keys(this.CUMULATIVE_PRIO_TO_PERCENTAGE_MAP);
    const index = priorities.indexOf(priorityKey);
    return (index > 0) ? priorities[index - 1] : "";
  }

  calculateProbability(studentPriority, availableSlots, totalDemand, hasStudentsWithPriority) {
    if (availableSlots <= 0 || totalDemand <= 0) {
      return -1.0;
    } 

    const studentPriorityKey = studentPriority.toLowerCase().replace(/\s+/g, "");
    if (hasStudentsWithPriority) {
      const cumulativePercentage = this.CUMULATIVE_PRIO_TO_PERCENTAGE_MAP[studentPriorityKey] ?? 0;
      const previousPriority = this.getPreviousPriority(studentPriorityKey);
      const previousCumulativePercentage = this.CUMULATIVE_PRIO_TO_PERCENTAGE_MAP[previousPriority] ?? 0;

      const demandPriority = totalDemand * (cumulativePercentage - previousCumulativePercentage);
      const demandHigherPriority = totalDemand * cumulativePercentage;

      if (availableSlots > demandHigherPriority) {
        return 1.0;
      } else {
        const slotsPriority = Math.max(
          availableSlots - (demandHigherPriority - demandPriority),
          0
        );
        return (demandPriority > 0) ? Math.round((slotsPriority / demandPriority) * 100) / 100 : 0;
      }
    } else {
      return Math.round(Math.min(availableSlots / totalDemand, 1.0) * 100) / 100;
    }
  }

  // calculateProbability(_p, avail, total, _h) {
  //   if (total <= 0) return 0.00;
  //   const raw = avail / total;
  //   return Math.round(Math.min(raw, 1.0) * 100) / 100;
  // }
}