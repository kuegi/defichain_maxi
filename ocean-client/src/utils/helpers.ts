import { LoanVaultActive } from "@defichain/whale-api-client/dist/api/loan";
import { BigNumber } from "@defichain/jellyfish-api-core";

export function isNullOrEmpty(value: string): boolean {
    return value === undefined || value.length === 0
}

export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function nextCollateralValue(vault: LoanVaultActive): BigNumber {
    let nextCollateral = new BigNumber(0)
    vault.collateralAmounts.forEach(collateral => {
        if (collateral.symbol == "DUSD") {
            nextCollateral= nextCollateral.plus(new BigNumber(collateral.amount).multipliedBy(0.99)) //no oracle price for DUSD, fixed 0.99
        } else {
            nextCollateral= nextCollateral.plus(new BigNumber(collateral.amount).multipliedBy(collateral.activePrice?.next?.amount ?? 0))
        }
    })
    return nextCollateral
}


export function nextLoanValue(vault: LoanVaultActive): BigNumber {
    let nextLoan = new BigNumber(0)
    vault.loanAmounts.forEach(loan => {
        if (loan.symbol == "DUSD") {
            nextLoan = nextLoan.plus(loan.amount) // no oracle for DUSD
        } else {
            nextLoan = nextLoan.plus(new BigNumber(loan.amount).multipliedBy(loan.activePrice?.next?.amount ?? 1))
        }
    })
    return nextLoan
}

export function nextCollateralRatio(vault: LoanVaultActive): BigNumber {
    const nextLoan = nextLoanValue(vault)
    return nextLoan.lte(0) ?
            new BigNumber(-1) : 
            nextCollateralValue(vault).dividedBy(nextLoan).multipliedBy(100).decimalPlaces(0,BigNumber.ROUND_FLOOR)
}