const fetch = require('node-fetch');

exports.handler = async function () {
  try {
    /*const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
    const JIRA_EMAIL = process.env.JIRA_EMAIL;
    const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;*/

    const JIRA_BASE_URL='https://vijaykrishnan.atlassian.net';
    const JIRA_EMAIL='soundarakrishna@gmail.com';
    const JIRA_API_TOKEN='ATATT3xFfGF0S85rKZIc0LCrzXGRNYuAcAcUORMaIYynh_gh3a3-4dqPzreWWmD3Yhoxxzs9rS8ejKmOw36_U9eGOd5E-YORpnVeBTuIty8yHn_J5w4CGkzKHJ6tQrBx0nWZIIvYbgkfHpfxF46EC2zU0N_DfyL4xlCxUOznn5_OVFYmbsyKIHI=C246E738';
    
    
    console.log("Fetching stories from Jira...");
    console.log(`JIRA_BASE_URL: ${JIRA_BASE_URL}`);
    console.log(`JIRA_EMAIL: ${JIRA_EMAIL}`);
    console.log(`JIRA_API_TOKEN: ${JIRA_API_TOKEN ? '***' : 'Not Set'}`);

    const response = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/search?jql=assignee=currentUser() AND issuetype=Story&fields=summary,description,status`,
      {
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64'),
          Accept: 'application/json'
        }
      }
    );

    const data = await response.json();

    const stories = data.issues.map(issue => ({
      id: issue.key,
      title: issue.fields.summary,
      description: parseADF(issue.fields.description),
      status: issue.fields.status.name
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ stories })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function parseADF(description) {
  if (!description || !description.content) return '';

  return description.content
    .map(block =>
      (block.content || [])
        .map(c => c.text || '')
        .join('')
    )
    .join('\n');
}
