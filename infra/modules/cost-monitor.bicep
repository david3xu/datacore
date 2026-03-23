// modules/cost-monitor.bicep — Budget alerts for Datacore spend

@description('Monthly budget in AUD')
param monthlyBudgetAUD int = 15

@description('Email to send alerts to')
param alertEmail string

@description('Resource group to monitor')
param resourceGroupName string

@description('Budget start date (yyyy-MM format)')
param startDate string = utcNow('yyyy-MM')

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'budget-datacore'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetAUD
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: '${startDate}-01'
    }
    filter: {
      dimensions: {
        name: 'ResourceGroup'
        operator: 'In'
        values: [resourceGroupName]
      }
    }
    notifications: {
      halfBudget: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: [alertEmail]
        locale: 'en-us'
      }
      overBudget: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [alertEmail]
        locale: 'en-us'
      }
    }
  }
}

output budgetName string = budget.name
output monthlyLimit int = monthlyBudgetAUD
