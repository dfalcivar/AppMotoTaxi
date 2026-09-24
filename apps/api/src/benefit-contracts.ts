/** Reserved contracts: no rewards are executed until a type handler is enabled and tested. */
export type BenefitExpiration = {type:'NONE'} | {type:'FIXED';at:string} | {type:'AFTER_ACTIVATION';days:number};
export interface PromotionalCredit {
 redemptionId:string;userId:string;currency:'USD';amount:string;remaining:string;expiresAt:string|null;
 // Future consumption must reserve/release individual credits before touching real wallet funds.
}
export type VerifiedRewardEvent = 'DRIVER_APPROVED'|'FIRST_COMPLETED_TRIP'|'COMPLETED_TRIP_TARGET';
export interface ReferralRewardConfiguration {
 requiredEvent:VerifiedRewardEvent;requiredTrips?:number;referrerBenefitCode:string;referredBenefitCode:string;
}
export interface RewardProgress {current:number;target:number;completed:boolean;}
export interface TripRewardConfiguration {
 requiredTrips:number;periodDays:number;rewardBenefitCode:string;maxRedemptions:number;
}
export interface DiscountConfiguration {
 maximumDiscount:string;minimumTripAmount:string;maximumUses:number;expiration:BenefitExpiration;
}
export interface VerifiedReferral {
 id:string;referrerUserId:string;referredUserId:string;sourceEventId:string;
 // Future persistence must enforce unique referredUserId and sourceEventId, verify real events,
 // and reject equal real user, normalized email or phone. No public grant endpoint exists today.
}
