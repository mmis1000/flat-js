module.exports = {
  collectLabel: function collectLabel(labeldStatement) {
    var labels = [];
    while (labeldStatement.type === 'LabeledStatement') {
      labels.push(labeldStatement.label.name);
      labeldStatement = labeldStatement.body;
    }
    return {
      statement: labeldStatement,
      labels: labels
    }
  }
}