export function detectColumns(firstRow:any){

const columns=Object.keys(firstRow);

return{

employee:

columns.find(c=>
c.toLowerCase().includes("employee")
) || "Employee",

// FIXED — detect "In Date"
date:

columns.find(c=>
c.toLowerCase().includes("in date")
)

|| columns.find(c=>
c.toLowerCase()==="date"
)

|| "In Date",

totalHours:

columns.find(c=>
c.toLowerCase().includes("total")
&& c.toLowerCase().includes("hour")
)

|| "Total Hours",

unpaidBreak:

columns.find(c=>
c.toLowerCase().includes("unpaid")
&& c.toLowerCase().includes("break")
)

|| "Unpaid Break Time",

job:

columns.find(c=>
c.toLowerCase().includes("job")
)

|| "Job Title"

}

}



export function analyzeBreaks(data:any[]){

if(!data.length) return null;

const cols=detectColumns(data[0]);

const aggregated:any={};

data.forEach(row=>{

const employee=row[cols.employee]?.trim();

const rawDate=row[cols.date];

const totalHours=parseFloat(
row[cols.totalHours]
)||0;

const unpaidBreak=parseFloat(
row[cols.unpaidBreak]
)||0;

const job=row[cols.job];

if(!employee || !rawDate || totalHours===0)
return;


// ⭐ FIXED DATE EXTRACTION
// "2/9/26 9:35 AM" → "2/9/26"

const date=String(rawDate).split(" ")[0];


const key=`${employee}|${date}`;

if(!aggregated[key]){

aggregated[key]={

employee,
date,

totalHours:0,
unpaidBreak:0,

jobs:new Set()

};

}

aggregated[key].totalHours+=totalHours;

aggregated[key].unpaidBreak+=unpaidBreak;

if(job)
aggregated[key].jobs.add(job);

});


const violations={

critical:[],
standard:[]

} as any;


Object.values(aggregated).forEach((entry:any)=>{

// ⭐ REQUIRED BREAK RULES

let requiredBreak=0;

if(entry.totalHours>=10){

requiredBreak=1;

}

else if(entry.totalHours>=5){

requiredBreak=0.5;

}


// ⭐ ONLY UNPAID BREAK COUNTS

if(

requiredBreak>0 &&

entry.unpaidBreak < requiredBreak

){

const violation={

employee:entry.employee,

date:entry.date,

totalHours:

entry.totalHours.toFixed(2),

unpaidBreak:

entry.unpaidBreak.toFixed(2),

requiredBreak:

requiredBreak.toFixed(2),

shortage:

(

requiredBreak-

entry.unpaidBreak

).toFixed(2),

job:

Array.from(entry.jobs).join(", "),

type:

entry.totalHours>6 &&

entry.unpaidBreak===0

?

"NO_WAIVER_ALLOWED"

:

"INSUFFICIENT_BREAK"

};


if(

violation.type==="NO_WAIVER_ALLOWED"

){

violations.critical.push(violation);

}

else{

violations.standard.push(violation);

}

}

});

return violations;

}