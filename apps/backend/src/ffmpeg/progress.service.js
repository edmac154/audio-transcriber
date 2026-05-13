
function parseProgress(stderrLine) {

  const result = {
    progress: 0,
    eta: '--',
    stage: 'Processing'
  };

  const timeMatch = stderrLine.match(/time=(\d+):(\d+):(\d+)/);

  if (timeMatch) {

    result.progress = Math.min(
      result.progress + 5,
      100
    );

    result.eta = 'Calculating...';
  }

  return result;
}

module.exports = {
  parseProgress
};
