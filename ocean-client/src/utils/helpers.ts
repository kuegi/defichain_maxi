export function isNullOrEmpty(value: string): boolean {
    return value === undefined || value.length === 0
}

export function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}