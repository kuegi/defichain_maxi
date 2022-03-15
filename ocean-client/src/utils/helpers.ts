import { LoanVaultActive } from "@defichain/whale-api-client/dist/api/loan";

export function isNullOrEmpty(value: string): boolean {
    return value === undefined || value.length === 0
}

export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function nextCollateralValue(vault: LoanVaultActive): number {
    let nextCollateral = 0
    vault.collateralAmounts.forEach(collateral => {
        if (collateral.symbol == "DUSD") {
            nextCollateral += Number(collateral.amount) * 0.99 //no oracle price for DUSD, fixed 0.99
        } else {
            nextCollateral += Number(collateral.activePrice?.next?.amount ?? 0) * Number(collateral.amount)
        }
    })
    return nextCollateral
}


export function nextLoanValue(vault: LoanVaultActive): number {
    let nextLoan = 0
    vault.loanAmounts.forEach(loan => {
        if (loan.symbol == "DUSD") {
            nextLoan += Number(loan.amount) // no oracle for DUSD
        } else {
            nextLoan += Number(loan.activePrice?.next?.amount ?? 1) * Number(loan.amount)
        }
    })
    return nextLoan
}

export function nextCollateralRatio(vault: LoanVaultActive): number {
    const nextLoan = nextLoanValue(vault)
    return nextLoan <= 0 ? -1 : Math.floor(100 * nextCollateralValue(vault) / nextLoan)
}